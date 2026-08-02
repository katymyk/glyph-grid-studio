/**
 * Video sources: an uploaded clip, sampled one frame at a time.
 *
 * A video is registered out-of-band and referenced from `scene.source.image` by a
 * short id (`video:1`) rather than inlined the way an image data URL is. Not an
 * optimisation — a data URL of a 40MB clip is a 54MB string sitting in the scene, and
 * the scene is cloned into the undo stack on every edit.
 *
 * Three problems this file exists to solve, none of which the modes should ever see:
 *
 *  1. **Seeking is async and serial.** One `HTMLVideoElement` can service one seek at a
 *     time, so requests queue. The queue is bounded and LIFO: while scrubbing, the
 *     frame under the playhead right now matters more than the one it passed.
 *  2. **Blanking looks broken.** Returning null while a seek is in flight would flicker
 *     the canvas to empty on every frame of playback. Instead the most recent frame at
 *     that grid is held — and `markSourcePending()` is raised, so an export never
 *     mistakes the substitute for the real thing (see `sourceReady.ts`).
 *  3. **Frames are big.** ~4.7MB per 1024×576 sample, so the cache is budgeted in bytes
 *     and evicts least-recently-used, unlike the unbounded image cache next door.
 *
 * Determinism note: same machine + same scene ⇒ identical output, which is what the
 * preview/export agreement needs. Byte-identical output across *browsers* is not on
 * offer for video and never was — decoders differ.
 */
import { VIDEO_REF_PREFIX, videoRefSeq } from '../domain/sources';
import { fidelity, markSourcePending, notifySourceReady, onFidelityChange } from './sourceReady';
import { gridId, sampleBytes, sampleDrawable, type Sample, type SampleGrid } from './sampleGrid';

/** Re-exported so the many callers that ask "is this a clip?" keep one import site,
    while the fact itself lives in the DOM-free domain layer (project saving needs it). */
export { isVideoRef } from '../domain/sources';

/** What the UI needs to describe a loaded clip. */
export interface VideoInfo {
  ref: string;
  name: string;
  width: number;
  height: number;
  duration: number; // seconds; 0 when the container doesn't report one
}

/** One outstanding frame request. `frame`/`fps` rather than a time, so read-ahead can
    step by whole frames and land on the same cache keys the renderer asks for. */
interface Wanted {
  grid: SampleGrid;
  frame: number;
  fps: number;
}

/**
 * State for one clip while the transport is playing.
 *
 * `mark` changes when a new frame has been *presented*, which is the only safe moment to
 * read pixels. The pixels are then grabbed lazily, once per grid, in `sampleVideoFrame` —
 * NOT in the presentation callback, which fires at the clip's rate (30–60Hz) and would do
 * five times the work needed to feed a 12fps preview.
 */
interface LiveState {
  mark: number;
  /** Per grid: the mark whose pixels are already in `held`. */
  sampledMark: Map<string, number>;
  /** Clip position of the presented frame, ms. */
  mediaMs: number;
  /** rVFC handle; 0 when the browser has no rVFC and the fallback clock is in use. */
  rvfc: number;
  usesRvfc: boolean;
  /** Wall-clock times of recent resyncs, for the damper. */
  resyncs: number[];
  /** Don't re-check drift before this instant. A seek is asynchronous, so the clip clock
      keeps reporting the OLD position for a while after one is issued — checking again
      inside that window fires a second resync for a drift already being corrected, and
      three of those in a row trip the damper for no reason. */
  quietUntil: number;
}

interface Entry {
  info: VideoInfo;
  el: HTMLVideoElement;
  url: string;
  wanted: Wanted[];
  pumping: boolean;
  /** The last request served for real (not read-ahead) — the anchor for read-ahead. */
  last: Wanted | null;
  /** Non-null while this clip is being sampled from native playback. */
  live: LiveState | null;
  /** Bumped when the regime changes, so a seek finishing afterwards discards its result
      instead of caching a frame from the wrong position. */
  generation: number;
  /** Live playback proved unusable for this clip (play() refused, or resync storm), so it
      stays on the seek path for the rest of the session. Slow but correct. */
  liveDisabled: boolean;
}

const videos = new Map<string, Entry>();
let seq = 0;

export function videoInfo(ref: string): VideoInfo | null {
  return videos.get(ref)?.info ?? null;
}

/**
 * Push the id counter past every reference in `refs`.
 *
 * Called when a project is loaded. Ids come from a per-session counter, so without this
 * a restored scene pointing at `video:1` and the very next clip you upload — also minted
 * `video:1` — would collide, and that layer would silently start rendering a file it has
 * nothing to do with. Reserving is cheap and makes the collision impossible rather than
 * unlikely.
 */
export function reserveVideoRefs(refs: string[]): void {
  for (const r of refs) seq = Math.max(seq, videoRefSeq(r));
}

/**
 * Take a picked file and make it samplable. Resolves once metadata is known *and* the
 * first frame has decoded, so the paint that follows the upload shows the clip rather
 * than one black frame.
 */
export async function registerVideo(file: File): Promise<VideoInfo> {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () =>
        reject(new Error("This browser can't decode that video. Try an H.264 MP4 or a WebM."));
    });
    await seekTo(el, 0);
    if (!(el.videoWidth > 0)) throw new Error('That video decoded no picture.');
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  const ref = `${VIDEO_REF_PREFIX}${++seq}`;
  const info: VideoInfo = {
    ref,
    name: file.name,
    width: el.videoWidth,
    height: el.videoHeight,
    // Live/fragmented sources report Infinity; treat that as "unknown length".
    duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0,
  };
  videos.set(ref, {
    info,
    el,
    url,
    wanted: [],
    pumping: false,
    last: null,
    live: null,
    generation: 0,
    liveDisabled: false,
  });
  return info;
}

// ------------------------------------------------------------------ frame cache

/** Roughly twenty 1024×576 frames. Big enough that read-ahead and a short scrub both
    hit; small enough that a long export doesn't grow without bound. */
const FRAME_BUDGET_BYTES = 96 * 1024 * 1024;

/** Insertion-ordered, so the oldest key is the front — a Map IS the LRU list. */
const frames = new Map<string, Sample>();
let frameBytes = 0;

/** Most recent sample per (ref, grid). What gets held while a seek is in flight. These
    references can outlive eviction from `frames`, which is the point: one frame per
    grid stays alive so the canvas has something to show. */
const held = new Map<string, Sample>();

const gridKey = (ref: string, g: SampleGrid) => `${ref}#${gridId(g)}`;
const frameKey = (ref: string, g: SampleGrid, ms: number) => `${gridKey(ref, g)}#${ms}`;

function cacheGet(k: string): Sample | undefined {
  const hit = frames.get(k);
  if (hit) {
    frames.delete(k); // re-insert at the back: most recently used
    frames.set(k, hit);
  }
  return hit;
}

function cachePut(k: string, s: Sample): void {
  const prev = frames.get(k);
  if (prev) {
    frames.delete(k);
    frameBytes -= sampleBytes(prev);
  }
  frames.set(k, s);
  frameBytes += sampleBytes(s);
  for (const [ek, es] of frames) {
    if (frameBytes <= FRAME_BUDGET_BYTES) break;
    if (ek === k) continue; // never evict what we just stored
    frames.delete(ek);
    frameBytes -= sampleBytes(es);
  }
}

/** Drop every decoded frame. Pure cache, so this only costs re-seeking; the clips
    themselves stay registered, because an undo can bring a scene that references one
    back. Called on reset, where the alternative is pinning ~96MB for the tab's life. */
export function clearVideoFrames(): void {
  frames.clear();
  held.clear();
  frameBytes = 0;
}

// ------------------------------------------------------------------ frame timing

/**
 * Scene frame index → a position inside the clip, in whole milliseconds.
 *
 * Three decisions live here.
 *
 * **The CENTRE of the frame, not its leading edge.** A scene frame covers the clip interval
 * `[f/fps, (f+1)/fps)`, and seeking to the boundary is what made an export repeat frames:
 * at 12fps, frame 1 is at 83.333ms, but a millisecond-rounded 83ms sits just *before* it, so
 * the decoder presents frame 0 again. Aiming half a frame in is both the correct
 * representative of the interval and immune to that rounding in either direction.
 *
 * **Past the end the last frame is held** rather than going blank, so a 3s clip on a 10s
 * timeline freezes instead of disappearing mid-comp.
 *
 * **Quantised to 1ms and used as the cache key**, so every scene frame that lands on the
 * same clip position — all of the held tail, or any frame at all when the scene runs faster
 * than the clip — shares one decode.
 *
 * Exported because it is the only part of video sampling that is pure, and therefore the
 * only part the headless check can exercise.
 */
export function clipMs(info: VideoInfo, frame: number, fps: number): number {
  const rate = fps || 25;
  const t = (frame + 0.5) / rate;
  if (!(info.duration > 0)) return 0;
  // Nudge off the very end: seeking exactly to `duration` can land past the last frame
  // and decode nothing at all.
  const last = Math.max(0, info.duration - 1 / 240);
  return Math.round((t < 0 ? 0 : t > last ? last : t) * 1000);
}

// ------------------------------------------------------------------ sampling

/**
 * The video branch of `sampleSource`. Synchronous like the image branch: returns what
 * it has now and arranges for the rest to arrive.
 */
export function sampleVideoFrame(
  ref: string,
  grid: SampleGrid,
  frame: number,
  fps: number,
): Sample | null {
  const e = videos.get(ref);
  // A ref with no clip behind it: nothing to decode and nothing to wait for, so this
  // is NOT pending — marking it so would make an export spin until it timed out.
  if (!e) return null;

  const ms = clipMs(e.info, frame, fps);
  const gk = gridKey(ref, grid);

  // Playing: sample whatever the element is showing. Started lazily here rather than from
  // the regime listener so a clip no layer is rendering never spins up a decoder.
  if (fidelity() === 'live' && !e.liveDisabled) {
    if (!e.live) startLive(e);
    if (e.live) return liveSample(e, e.live, gk, grid, ms, fps);
  }

  const hit = cacheGet(frameKey(ref, grid, ms));
  if (hit) {
    held.set(gk, hit);
    return hit;
  }

  markSourcePending(); // this frame is not the one that was asked for
  request(e, { grid, frame, fps });
  return held.get(gk) ?? null;
}

// ------------------------------------------------------------------ live playback

/**
 * How far the clip may drift from the playhead before a seek is worth it.
 *
 * Scaled by the scene frame rate because the steady-state offset already is: the frame on
 * screen is up to one scene frame plus one clip frame behind the position being asked for,
 * and chasing that would mean seeking every frame — the stall this whole regime exists to
 * avoid. Exported (with `shouldResync`) because it is the one part of live playback that is
 * pure, and therefore the only part the headless check can exercise.
 */
export function resyncThresholdMs(fps: number): number {
  return Math.max(250, 2500 / Math.max(1, fps));
}

export function shouldResync(wantMs: number, mediaMs: number, fps: number): boolean {
  return Math.abs(wantMs - mediaMs) > resyncThresholdMs(fps);
}

/** More than this many resyncs inside the window means live playback is not working for
    this clip — see the damper in `resync`. */
const RESYNC_WINDOW_MS = 1500;
const RESYNC_LIMIT = 3;
/** How long a resync is given to land before drift is judged again. Generous: a seek plus
    a presented frame is tens of milliseconds at best, and being early here is what makes a
    single legitimate correction look like a storm. */
const RESYNC_SETTLE_MS = 400;

type FrameMeta = { mediaTime: number };
type WithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function startLive(e: Entry): void {
  if (e.live || e.liveDisabled) return;
  // Abandon queued seeks and invalidate any in flight: the element is about to move.
  e.wanted.length = 0;
  e.generation++;
  const L: LiveState = {
    mark: 0,
    sampledMark: new Map(),
    mediaMs: e.el.currentTime * 1000,
    rvfc: 0,
    usesRvfc: false,
    resyncs: [],
    quietUntil: 0,
  };
  e.live = L;

  const rvfc = (e.el as WithRVFC).requestVideoFrameCallback;
  if (typeof rvfc === 'function') {
    L.usesRvfc = true;
    const step = (_now: number, meta: FrameMeta) => {
      if (e.live !== L) return; // regime changed; stop rescheduling
      L.mark++;
      L.mediaMs = meta.mediaTime * 1000;
      L.rvfc = rvfc.call(e.el, step);
    };
    L.rvfc = rvfc.call(e.el, step);
  }
  // Muted playback of a detached element is normally allowed, but policies vary. If it is
  // refused we must fall back rather than freeze on one held frame for the whole playback.
  void e.el.play().catch((err: unknown) => disableLive(e, `play() was refused: ${String(err)}`));
}

/**
 * Fall back to seeking for the rest of the session.
 *
 * Logged rather than silent: "video is as slow as it used to be" is a support question, and
 * the two reasons (a refused `play()` vs a clip being pulled in two directions) need
 * completely different answers.
 */
function disableLive(e: Entry, why: string): void {
  if (e.liveDisabled) return;
  e.liveDisabled = true;
  console.warn(`video ${e.info.name}: smooth playback unavailable, falling back to seeking — ${why}`);
  stopLive(e);
}

function stopLive(e: Entry): void {
  const L = e.live;
  if (!L) return;
  e.live = null; // makes the rVFC chain stop rescheduling itself
  const cancel = (e.el as WithRVFC).cancelVideoFrameCallback;
  if (L.rvfc && typeof cancel === 'function') cancel.call(e.el, L.rvfc);
  e.generation++;
  e.el.pause();
  // `held` is deliberately NOT cleared: it is the substitute the next paused paint shows
  // while the exact seek runs, and blanking it brings back the scrub flicker.
  //
  // But the canvas MUST be told to repaint, and nothing else will tell it. Pausing changes
  // no scene state, and a loop that wraps to exactly frame 0 means even a Home press is a
  // no-op — so the approximate frame would sit on screen indefinitely, and the artwork you
  // stopped on would not be the artwork you export. This is precisely "the best available
  // pixels changed", which is what this notification means.
  notifySourceReady();
}

/** rVFC is the only signal that a frame has been *presented*; without it (Firefox) the
    clip clock is the best available stand-in — a changed currentTime means a new frame. */
function liveMark(e: Entry, L: LiveState): number {
  return L.usesRvfc ? L.mark : Math.round(e.el.currentTime * 1000);
}

function liveMediaMs(e: Entry, L: LiveState): number {
  return L.usesRvfc ? L.mediaMs : e.el.currentTime * 1000;
}

function liveSample(
  e: Entry,
  L: LiveState,
  gk: string,
  grid: SampleGrid,
  wantMs: number,
  fps: number,
): Sample | null {
  // Don't judge drift while a correction is still landing, and never while the element is
  // mid-seek: the clip clock reports the old position until the seek completes, so a second
  // look inside that window sees the same drift and fires a redundant resync.
  if (performance.now() >= L.quietUntil && !e.el.seeking && shouldResync(wantMs, liveMediaMs(e, L), fps)) {
    resync(e, L, wantMs);
    if (!e.live) return held.get(gk) ?? null; // the damper gave up mid-call
  }
  const mark = liveMark(e, L);
  // The `!held.has(gk)` clause covers a cold start and a cleared cache; two layers at
  // different grids each need their own downscale of the same presented frame.
  if ((L.sampledMark.get(gk) !== mark || !held.has(gk)) && e.el.videoWidth > 0) {
    held.set(gk, sampleDrawable(e.el, e.el.videoWidth, e.el.videoHeight, grid));
    L.sampledMark.set(gk, mark);
  }
  // No markSourcePending() and no notifySourceReady(): during playback this IS the frame,
  // and the loop already repaints once per scene frame. An export can never reach here —
  // export/frames.ts latches fidelity to 'exact' first.
  return held.get(gk) ?? null;
}

/**
 * Nudge the clip back onto the playhead.
 *
 * Fire-and-forget rather than `seekTo()`: that awaits `seeked` plus a presentation callback,
 * which would block the very loop this is meant to keep moving. One threshold check covers
 * four cases that would otherwise each need code — the timeline looping, a keyframed
 * `srcTime` jump-cut, a decoder stall, and resuming playback somewhere else.
 */
function resync(e: Entry, L: LiveState, wantMs: number): void {
  const now = performance.now();
  L.resyncs = L.resyncs.filter((t) => now - t < RESYNC_WINDOW_MS);
  L.resyncs.push(now);
  if (L.resyncs.length > RESYNC_LIMIT) {
    // A decoder that cannot keep up, or a scene asking this element for two positions at
    // once. (The second used to be reachable — two layers on one clip at different
    // `srcTime` — and now isn't: there is one source, and one offset, per scene. The guard
    // stays for the first.) Seeking every frame is the stall this regime exists to avoid,
    // so give up on live for this clip: slower, but correct and stable.
    disableLive(e, `${L.resyncs.length} resyncs in ${RESYNC_WINDOW_MS}ms`);
    return;
  }
  L.quietUntil = now + RESYNC_SETTLE_MS;
  e.el.currentTime = wantMs / 1000;
  // A clip shorter than the timeline reaches `ended` and needs a fresh play() after the
  // loop wraps.
  if (e.el.paused) {
    void e.el.play().catch((err: unknown) => disableLive(e, `play() was refused: ${String(err)}`));
  }
}

// Pausing, stepping and every export latch back to 'exact'; that must stop playback
// immediately, so the exact path's first seek starts from a known position.
onFidelityChange((f) => {
  if (f === 'exact') for (const e of videos.values()) stopLive(e);
});

/** Queue a frame request, newest-wins. */
const MAX_WANTED = 6;

function request(e: Entry, w: Wanted): void {
  const ms = clipMs(e.info, w.frame, w.fps);
  if (
    e.wanted.some(
      (q) => gridId(q.grid) === gridId(w.grid) && clipMs(e.info, q.frame, q.fps) === ms,
    )
  ) {
    return;
  }
  e.wanted.push(w);
  // Bounded: a fast scrub can outrun the decoder indefinitely, and the frames it flew
  // past are worthless by the time they'd be served.
  if (e.wanted.length > MAX_WANTED) e.wanted.shift();
  if (!e.pumping) void pump(e);
}

/** How far ahead of the playhead to decode once nothing is being waited on. Small on
    purpose: it turns playback and a sequence export from seek-per-frame stalls into a
    steady walk, without committing the decoder to work that a scrub would waste. */
const READ_AHEAD = 3;

function nextReadAhead(e: Entry): Wanted | null {
  const l = e.last;
  if (!l) return null;
  for (let i = 1; i <= READ_AHEAD; i++) {
    const frame = l.frame + i;
    const ms = clipMs(e.info, frame, l.fps);
    if (!frames.has(frameKey(e.info.ref, l.grid, ms))) {
      return { grid: l.grid, frame, fps: l.fps };
    }
  }
  return null;
}

async function pump(e: Entry): Promise<void> {
  e.pumping = true;
  try {
    for (;;) {
      if (e.live) return; // playback took over; queued seeks are worthless now
      // LIFO: the newest ask is the frame the user is looking at.
      const w = e.wanted.pop();
      if (w) {
        e.last = w;
        await serve(e, w, true);
        continue;
      }
      const ahead = nextReadAhead(e);
      if (!ahead) return;
      // Read-ahead must not become its own anchor, or the window walks off forever.
      await serve(e, ahead, false);
    }
  } finally {
    e.pumping = false;
  }
}

/**
 * Decode one requested frame into the cache.
 *
 * **An explicit request ALWAYS ends in a notification** — that invariant is what the
 * `finally` is for, and it is load-bearing rather than tidy. Read-ahead deliberately stays
 * silent (it runs only when nobody is waiting, so a notification would buy a repaint
 * nobody asked for), and the two used to interact badly:
 *
 *   read-ahead decodes frame f+1 → an export asks for f+1 and queues a request →
 *   read-ahead's decode lands, silently → the pump pops the request, finds the frame
 *   already cached, and returns without a word → nobody ever tells the waiter.
 *
 * The export then sat out the full readiness timeout and wrote the PREVIOUS frame into the
 * file. A sequence export on a cold cache came out with duplicated frames every few
 * frames, eight seconds apart, and nothing logged it. The same silence covered every path
 * that produces no data (a dropped seek, a decoder that returned nothing): those must
 * notify too, so the caller gets a prompt retry instead of a stall.
 */
async function serve(e: Entry, w: Wanted, notify: boolean): Promise<void> {
  const ms = clipMs(e.info, w.frame, w.fps);
  const k = frameKey(e.info.ref, w.grid, ms);
  try {
    if (frames.has(k)) return; // already decoded — by read-ahead, or by an earlier ask
    const gen = e.generation;
    try {
      await seekTo(e.el, ms / 1000);
      // Playback may have started during the seek, which moves the element off this
      // position. Sampling now would cache a LATER frame under this frame's key and poison
      // the exact cache for the rest of the session — invisible until someone compares an
      // export against the canvas.
      if (e.generation !== gen) return;
      if (!(e.el.videoWidth > 0)) return;
      cachePut(k, sampleDrawable(e.el, e.el.videoWidth, e.el.videoHeight, w.grid));
    } catch {
      return; // a dropped seek costs one frame, never the pump
    }
  } finally {
    if (notify) notifySourceReady();
  }
}

// ------------------------------------------------------------------ seeking

/** Give up on a seek rather than stall an export behind a decoder that won't answer. */
const SEEK_TIMEOUT_MS = 4000;
/** After 'seeked', how long to wait for the frame to actually be presented. */
const PRESENT_TIMEOUT_MS = 150;

/**
 * Seek and resolve once the frame is safe to `drawImage`.
 *
 * `seeked` says the seek completed, not that the new frame has been *presented* —
 * drawing on that event alone can capture the previous frame on some engines.
 * `requestVideoFrameCallback` is the signal that it landed, so we wait for that when
 * it exists. Both are raced against timers: a browser that fires neither costs one
 * slow frame instead of hanging the whole export.
 */
function seekTo(el: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      const rvfc = (el as WithRVFC).requestVideoFrameCallback;
      if (typeof rvfc !== 'function') return finish();
      clearTimeout(timer);
      timer = setTimeout(finish, PRESENT_TIMEOUT_MS);
      rvfc.call(el, finish);
    };
    el.addEventListener('seeked', onSeeked);
    timer = setTimeout(finish, SEEK_TIMEOUT_MS);
    // Assigning the current time back fires no 'seeked' at all, so short-circuit —
    // otherwise every repeat request for the same frame waits out the timeout.
    if (Math.abs(el.currentTime - t) < 1e-3 && el.readyState >= 2) return finish();
    el.currentTime = t;
  });
}
