/**
 * MP4 export. Renders the scene across one loop and encodes it with WebCodecs, muxing
 * into an MP4 container in the browser — no server, no ffmpeg, no realtime capture.
 *
 * Why not `MediaRecorder` + `canvas.captureStream()`, which needs no dependency: it
 * records in *realtime*, so the file's frame timing is whatever the machine managed
 * while rendering. A halftone frame can take 200ms, which would come out as a stuttering
 * clip at the wrong length. WebCodecs encodes frame by frame, as fast or slow as the
 * render takes, and the output is exactly `fps × duration` frames long.
 *
 * The muxer is imported dynamically: it is by far the largest dependency in the app and
 * nothing else needs it, so the cost lands on the click, not on first paint.
 *
 * **Negotiation, not interrogation.** This file used to ask `getFirstEncodableVideoCodec`
 * whether a codec was usable and then encode with a *differently shaped* config. That
 * cost us Safari entirely: a capability probe that asks a different question is a second
 * source of truth, and the two disagreed. Now the ladder below is walked by actually
 * encoding the first frame, so "can this browser do it" and "did this browser do it" are
 * the same event. See `MP4_ATTEMPTS` and the note on where `configure()` happens.
 */
import type { BufferTarget, CanvasSource, Output, VideoCodec } from 'mediabunny';
import type { Scene } from '../../domain/scene';
import { paintSettled } from './frames';

/** One rung of the encode ladder; everything else about the encode is fixed. */
export type Mp4Attempt = {
  codec: VideoCodec;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
};

/**
 * Tried in order, by encoding a frame rather than by asking a capability API.
 *
 * `avc` appears twice at the top on purpose: for files going into After Effects and
 * Premiere, codec identity matters more than encode speed, so a *software* H.264 is a
 * better outcome than a hardware HEVC. All five are legal in an MP4 container.
 */
export const MP4_ATTEMPTS: readonly Mp4Attempt[] = [
  { codec: 'avc' },
  { codec: 'avc', hardwareAcceleration: 'prefer-software' },
  { codec: 'hevc' },
  { codec: 'vp9' },
  { codec: 'av1' },
];

/** What we asked for, what the browser was actually handed, and what it said. */
export type Mp4Failure = {
  attempt: Mp4Attempt;
  /** null when the failure happened before mediabunny built an encoder config. */
  config: VideoEncoderConfig | null;
  error: unknown;
};

/** Cheap synchronous capability check, for disabling the button without loading 10MB. */
export function mp4Supported(): boolean {
  return typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis;
}

export const MP4_UNSUPPORTED =
  'This browser has no WebCodecs video encoder, so it cannot write MP4. The PNG sequence ' +
  'imports into any editor and always works.';

function errorText(e: unknown): string {
  // `name` is the field nobody thinks to print and the one that tells you which bug you
  // have: TypeError = the browser's IDL rejected a member of the config dictionary,
  // NotSupportedError = it understood and said no, EncodingError = the encoder died.
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** One failed rung as one line: the exact config, and the browser's own words. */
export function describeMp4Failure(f: Mp4Failure): string {
  const c = f.config;
  const parts: string[] = [];
  if (c) {
    if (c.codec) parts.push(c.codec);
    if (c.width && c.height) parts.push(`${c.width}x${c.height}`);
    if (c.framerate) parts.push(`@${Math.round(c.framerate)}fps`);
    if (c.bitrate) {
      parts.push(`${Math.round(c.bitrate / 1000)} kbps${c.bitrateMode ? ` ${c.bitrateMode}` : ''}`);
    }
    parts.push(`hw ${c.hardwareAcceleration ?? f.attempt.hardwareAcceleration ?? 'no-preference'}`);
  } else {
    parts.push('no config built');
    if (f.attempt.hardwareAcceleration) parts.push(`hw ${f.attempt.hardwareAcceleration}`);
  }
  return `${f.attempt.codec} (${parts.join(', ')}) -> ${errorText(f.error)}`;
}

/** The message thrown when every rung failed. Shown verbatim by the export panel. */
export function mp4FailureMessage(failures: readonly Mp4Failure[]): string {
  const lines = failures.map((f) => `• ${describeMp4Failure(f)}`).join('\n');
  return (
    'This browser refused every MP4 encoder configuration that was tried:\n' +
    `${lines}\n` +
    'The PNG sequence imports into any editor and always works.'
  );
}

export type Mp4Export = { blob: Blob; codec: VideoCodec };

/** Composite the frame over white. H.264 carries no alpha, so a transparent scene would
    encode its fully-transparent pixels as black and invert the artwork. Same choice as
    the GIF path, and the button says so. */
function overWhite(ctx: CanvasRenderingContext2D, scene: Scene): void {
  if (scene.background !== null) return;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.globalCompositeOperation = 'source-over';
}

export async function sceneToMP4(
  scene: Scene,
  onProgress?: (p: number) => void,
): Promise<Mp4Export> {
  if (!mp4Supported()) throw new Error(MP4_UNSUPPORTED);
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } = await import('mediabunny');

  const fps = scene.fps || 25;
  const total = Math.max(1, Math.round(fps * scene.duration));

  // H.264 encodes 16×16 macroblocks over a 4:2:0 chroma plane, so an odd width or
  // height is rejected outright. Round UP to even and scale the paint to fit: cropping
  // would silently drop a column, padding would leave a one-pixel seam, and a scale of
  // 1921/1922 is not visible.
  const width = scene.width + (scene.width % 2);
  const height = scene.height + (scene.height % 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.setTransform(width / scene.width, 0, 0, height / scene.height, 0, 0);

  // Frame 0 is painted ONCE, before any encoder exists. `source.add` copies the canvas
  // into a VideoFrame rather than taking it over, and nothing on the failure path draws
  // here — so a rejected rung costs a muxer header and nothing else, and the ladder never
  // re-renders the animation.
  await paintSettled(ctx, scene, 0);
  overWhite(ctx, scene);

  /**
   * Rate control for every rung. `preferBitrate` is the load-bearing part: without it
   * mediabunny prefers quantizer-based encoding, which puts `bitrateMode: 'quantizer'` —
   * an enum member only Chromium has — through the WebCodecs dictionary conversion, where
   * a browser that doesn't know it *throws* rather than answering "unsupported". That
   * rejection is what killed the whole export in Safari.
   *
   * A quality level rather than a fixed number, because this canvas ranges from 100px to
   * 8000px and any constant bitrate is wrong at one end.
   */
  const rateControl = () => new Quality({ quality: 'high', preferBitrate: true });

  type Started = { output: Output; source: CanvasSource; target: BufferTarget; codec: VideoCodec };
  const failures: Mp4Failure[] = [];
  let run: Started | null = null;

  for (const attempt of MP4_ATTEMPTS) {
    const target = new BufferTarget();
    const output = new Output({
      // 'in-memory' puts the metadata at the front of the file, which is what makes it
      // seekable and playable without downloading the whole thing first.
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    // A holder rather than a plain `let`, so the value survives control-flow narrowing:
    // it is written from a callback the compiler cannot see running.
    const seen: { config: VideoEncoderConfig | null } = { config: null };
    const source = new CanvasSource(canvas, {
      codec: attempt.codec,
      quality: rateControl(),
      keyFrameInterval: 2,
      hardwareAcceleration: attempt.hardwareAcceleration,
      // The only way to see the config the browser actually rejected — mediabunny calls
      // this per candidate, before it asks whether that candidate is supported.
      onEncoderConfig: (c) => {
        seen.config = c;
      },
    });
    try {
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();
      // The encoder is configured inside the first `add`, NOT in `start()` — CanvasSource
      // has no `_start` of its own. So this line is the real failure point, and it is why
      // the ladder can retry at all without re-rendering.
      await source.add(0, 1 / fps);
    } catch (error) {
      const failure: Mp4Failure = { attempt, config: seen.config, error };
      failures.push(failure);
      // Logged even when a later rung succeeds: "it worked but fell back" is worth
      // knowing, and the console is the only place that survives a successful export.
      console.warn(`MP4 export: ${describeMp4Failure(failure)}`);
      await output.cancel().catch(() => {}); // must never mask `error`
      continue;
    }
    run = { output, source, target, codec: attempt.codec };
    break;
  }
  if (!run) throw new Error(mp4FailureMessage(failures));

  const { output, source, target, codec } = run;
  onProgress?.((1 / total) * 0.97);

  try {
    for (let f = 1; f < total; f++) {
      await paintSettled(ctx, scene, f / fps);
      overWhite(ctx, scene);
      // Awaited: this is the encoder's backpressure signal. Without it a long export
      // queues every frame at once and runs the tab out of memory.
      await source.add(f / fps, 1 / fps);
      onProgress?.(((f + 1) / total) * 0.97); // the tail is finalize()
    }
  } catch (e) {
    // An encoder error raised out of band surfaces here rather than during negotiation,
    // so it is reported rather than retried: a different codec is unlikely to fix it and
    // re-rendering the whole animation to find out is not worth it.
    await output.cancel().catch(() => {});
    throw e;
  }

  await output.finalize();
  onProgress?.(1);
  const buf = target.buffer;
  if (!buf) throw new Error('MP4 encoding produced no data.');
  return { blob: new Blob([buf], { type: 'video/mp4' }), codec };
}
