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
 */
import type { Scene } from '../../domain/scene';
import { paintSettled } from './frames';

/**
 * Tried in order. `avc` (H.264) first — it is the only one that plays everywhere,
 * including in After Effects and Premiere, which is where these files are going. The
 * rest are fallbacks for a browser that can't encode it.
 */
const CODECS = ['avc', 'hevc', 'vp9', 'av1'] as const;

/** Cheap synchronous capability check, for disabling the button without loading 10MB. */
export function mp4Supported(): boolean {
  return typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis;
}

export const MP4_UNSUPPORTED =
  'This browser has no WebCodecs video encoder, so it cannot write MP4. Chrome, Edge and ' +
  'Safari 16.4+ can; everywhere else, the PNG sequence imports into any editor.';

export async function sceneToMP4(scene: Scene, onProgress?: (p: number) => void): Promise<Blob> {
  if (!mp4Supported()) throw new Error(MP4_UNSUPPORTED);
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } =
    await import('mediabunny');

  const fps = scene.fps || 25;
  const total = Math.max(1, Math.round(fps * scene.duration));

  // H.264 encodes 16×16 macroblocks over a 4:2:0 chroma plane, so an odd width or
  // height is rejected outright. Round UP to even and scale the paint to fit: cropping
  // would silently drop a column, padding would leave a one-pixel seam, and a scale of
  // 1921/1922 is not visible.
  const width = scene.width + (scene.width % 2);
  const height = scene.height + (scene.height % 2);

  const codec = await getFirstEncodableVideoCodec([...CODECS], { width, height, quality: QUALITY_HIGH });
  if (!codec) throw new Error(MP4_UNSUPPORTED);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.setTransform(width / scene.width, 0, 0, height / scene.height, 0, 0);

  const target = new BufferTarget();
  const output = new Output({
    // 'in-memory' puts the metadata at the front of the file, which is what makes it
    // seekable and playable without downloading the whole thing first.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  // frameRate snaps timestamps to the grid, so no rounding drift accumulates over a
  // long clip and the file reports the frame rate the scene was authored at.
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  try {
    for (let f = 0; f < total; f++) {
      await paintSettled(ctx, scene, f / fps);
      // H.264 carries no alpha channel. A transparent scene would encode its
      // fully-transparent pixels as black and invert the artwork, so composite over
      // white — same choice as the GIF path, and the button says so.
      if (scene.background === null) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, scene.width, scene.height);
        ctx.globalCompositeOperation = 'source-over';
      }
      // Awaited: this is the encoder's backpressure signal. Without it a long export
      // queues every frame at once and runs the tab out of memory.
      await source.add(f / fps, 1 / fps);
      onProgress?.(((f + 1) / total) * 0.97); // the tail is finalize()
    }
  } catch (e) {
    await output.cancel();
    throw e;
  }

  await output.finalize();
  onProgress?.(1);
  const buf = target.buffer;
  if (!buf) throw new Error('MP4 encoding produced no data.');
  return new Blob([buf], { type: 'video/mp4' });
}
