/**
 * Video sources: an uploaded clip, sampled one frame at a time.
 *
 * A video is registered out-of-band and referenced from the layer's `image` param by a
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
import { markSourcePending, notifySourceReady } from './sourceReady';
import { sampleBytes, sampleDrawable, type Sample } from './sampleGrid';

const PREFIX = 'video:';

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
  cols: number;
  rows: number;
  frame: number;
  fps: number;
}

interface Entry {
  info: VideoInfo;
  el: HTMLVideoElement;
  url: string;
  wanted: Wanted[];
  pumping: boolean;
  /** The last request served for real (not read-ahead) — the anchor for read-ahead. */
  last: Wanted | null;
}

const videos = new Map<string, Entry>();
let seq = 0;

/** Is this `image` param value a video reference rather than an image data URL? */
export function isVideoRef(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith(PREFIX);
}

export function videoInfo(ref: string): VideoInfo | null {
  return videos.get(ref)?.info ?? null;
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
  const ref = `${PREFIX}${++seq}`;
  const info: VideoInfo = {
    ref,
    name: file.name,
    width: el.videoWidth,
    height: el.videoHeight,
    // Live/fragmented sources report Infinity; treat that as "unknown length".
    duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0,
  };
  videos.set(ref, { info, el, url, wanted: [], pumping: false, last: null });
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

const gridKey = (ref: string, cols: number, rows: number) => `${ref}#${cols}x${rows}`;
const frameKey = (ref: string, cols: number, rows: number, ms: number) =>
  `${gridKey(ref, cols, rows)}#${ms}`;

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
 * Two decisions live here. Past the end the **last frame is held** rather than going
 * blank, so a 3s clip on a 10s timeline freezes instead of disappearing mid-comp. And
 * the result is quantised to 1ms and used as the cache key, so every scene frame that
 * lands on the same clip position — all of the held tail, or any frame at all when the
 * scene runs faster than the clip — shares one decode.
 *
 * Exported because it is the only part of video sampling that is pure, and therefore the
 * only part the headless check can exercise.
 */
export function clipMs(info: VideoInfo, frame: number, fps: number): number {
  const t = frame / (fps || 25);
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
  cols: number,
  rows: number,
  frame: number,
  fps: number,
): Sample | null {
  const e = videos.get(ref);
  // A ref with no clip behind it: nothing to decode and nothing to wait for, so this
  // is NOT pending — marking it so would make an export spin until it timed out.
  if (!e) return null;

  const ms = clipMs(e.info, frame, fps);
  const gk = gridKey(ref, cols, rows);
  const hit = cacheGet(frameKey(ref, cols, rows, ms));
  if (hit) {
    held.set(gk, hit);
    return hit;
  }

  markSourcePending(); // this frame is not the one that was asked for
  request(e, { cols, rows, frame, fps });
  return held.get(gk) ?? null;
}

/** Queue a frame request, newest-wins. */
const MAX_WANTED = 6;

function request(e: Entry, w: Wanted): void {
  const ms = clipMs(e.info, w.frame, w.fps);
  if (e.wanted.some((q) => q.cols === w.cols && q.rows === w.rows && clipMs(e.info, q.frame, q.fps) === ms)) {
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
    if (!frames.has(frameKey(e.info.ref, l.cols, l.rows, ms))) {
      return { cols: l.cols, rows: l.rows, frame, fps: l.fps };
    }
  }
  return null;
}

async function pump(e: Entry): Promise<void> {
  e.pumping = true;
  try {
    for (;;) {
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

async function serve(e: Entry, w: Wanted, notify: boolean): Promise<void> {
  const ms = clipMs(e.info, w.frame, w.fps);
  const k = frameKey(e.info.ref, w.cols, w.rows, ms);
  if (frames.has(k)) return;
  try {
    await seekTo(e.el, ms / 1000);
    if (!(e.el.videoWidth > 0)) return;
    cachePut(k, sampleDrawable(e.el, e.el.videoWidth, e.el.videoHeight, w.cols, w.rows));
  } catch {
    return; // a dropped seek costs one frame, never the pump
  }
  // Read-ahead deliberately stays silent: it only runs when nothing is waiting, so a
  // notification would buy a repaint nobody asked for.
  if (notify) notifySourceReady();
}

// ------------------------------------------------------------------ seeking

/** Give up on a seek rather than stall an export behind a decoder that won't answer. */
const SEEK_TIMEOUT_MS = 4000;
/** After 'seeked', how long to wait for the frame to actually be presented. */
const PRESENT_TIMEOUT_MS = 150;

type WithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

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
