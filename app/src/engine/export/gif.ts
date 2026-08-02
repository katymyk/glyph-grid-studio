import GIF from 'gif.js';
import workerUrl from 'gif.js/dist/gif.worker.js?url';
import type { Scene } from '../../domain/scene';
import { frameCount } from '../../domain/timeline';
import { paintSettled, type ExportFidelity } from './frames';

/**
 * Longest side of a GIF export, in px.
 *
 * A GIF pays for pixels twice over. gif.js needs every frame in memory *uncompressed*
 * before `render()` can start — 8.3MB per frame at 1920×1080, so ~830MB for four seconds
 * at 25fps, which is where Safari fell over — and then NeuQuant-maps and LZW-packs every
 * one of those pixels. A full-HD GIF is a file nobody asked for at a cost nobody wants.
 *
 * So the longest side is capped. Capped, not silently downscaled: the real output size is
 * printed on the button, the same way the element cap discloses its effective pitch
 * (§13d). MP4 and the PNG sequence remain the full-resolution paths.
 */
export const GIF_MAX_SIDE = 720;

/** Output size for a GIF of a `width`×`height` scene. Never upscales; never returns 0. */
export function gifSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, GIF_MAX_SIDE / Math.max(1, Math.max(width, height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * How many encode workers to spawn.
 *
 * gif.js already clamps to the frame count, but each in-flight worker holds a full
 * structured-clone copy of a frame — and Safari cannot transfer the buffer (gif.js only
 * transfers on Chrome), so every dispatch is a real copy. The ceiling is therefore a
 * memory bound, not a CPU one. `cores` is a parameter rather than read from `navigator`
 * so this is testable under node, where the value is meaningless.
 */
export function gifWorkers(cores: number | undefined, frames: number): number {
  return Math.max(1, Math.min(frames, cores && cores > 0 ? cores : 4, 8));
}

/**
 * The GIF button's label, including the real output size.
 *
 * Lives here, next to the cap it discloses, rather than in the panel — the Export panel is
 * collapsed by default and a collapsed Base UI Collapsible renders no children under SSR,
 * so a label built in the component cannot be asserted headlessly. Keeping it beside
 * `GIF_MAX_SIDE` means "the cap is visible" is a property the build checks.
 */
export function gifButtonLabel(scene: {
  width: number;
  height: number;
  background: string | null;
}): string {
  const { width, height } = gifSize(scene.width, scene.height);
  // GIF carries no alpha here, so a transparent scene is flattened onto white; say so
  // rather than letting the file surprise them.
  const onWhite = scene.background === null ? ' · on white' : '';
  return `GIF (animated · ${width}×${height}${onWhite})`;
}

/** Render the scene across one loop into an animated GIF. Frame times step by 1/fps.
    The worker is bundled + same-origin (via ?url), so no cross-origin worker issue. */
export async function sceneToGIF(
  scene: Scene,
  onProgress?: (p: number) => void,
): Promise<{ blob: Blob; fidelity: ExportFidelity }> {
  const fps = scene.fps || 25;
  const total = frameCount(scene);
  const delay = Math.round(1000 / fps);
  const { width, height } = gifSize(scene.width, scene.height);
  const workers = gifWorkers(
    typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
    total,
  );
  const gif = new GIF({ workers, quality: 10, width, height, workerScript: workerUrl });

  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  // gif.js reads the whole canvas back to the CPU once per frame. On a GPU-backed canvas
  // that is a pipeline flush plus a readback, and it is the most expensive main-thread
  // item in this export — which is exactly what this hint is for.
  const ctx = off.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  // Scale the paint rather than the scene: `scene.width/height` stay the logical space,
  // so resolveScene produces the identical element list and the identical sample-cache
  // keys. Same composition, smaller raster.
  ctx.setTransform(width / scene.width, 0, 0, height / scene.height, 0, 0);

  const startedAt = performance.now();
  // paintSettled, not paintScene: a video frame still seeking (or an image still
  // decoding) would otherwise be encoded as a blank or a duplicate.
  let unsettled = 0;
  for (let f = 0; f < total; f++) {
    if (!(await paintSettled(ctx, scene, f / fps)).settled) unsettled++;
    // GIF has no alpha channel here: gif.js is configured without a transparent
    // index, so it reads raw RGBA and quantizes fully-transparent pixels (0,0,0,0)
    // to black. Compositing the frame over white keeps a transparent-background
    // scene looking like the preview instead of inverting it.
    if (scene.background === null) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, scene.width, scene.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    gif.addFrame(ctx, { copy: true, delay });
    onProgress?.(((f + 1) / total) * 0.5); // capture = first half of progress
    await new Promise((r) => setTimeout(r, 0));
  }
  const capturedAt = performance.now();

  const blob = await new Promise<Blob>((resolve) => {
    gif.on('progress', (p) => onProgress?.(0.5 + p * 0.5)); // encode = second half
    gif.on('finished', (blob) => {
      // Logged so the next "GIF is slow" report arrives with its own measurements, and
      // says which half was slow — the progress bar already splits capture from encode.
      const now = performance.now();
      console.info(
        `GIF: ${total} frames at ${width}×${height}, ${workers} workers, ` +
          `capture ${Math.round(capturedAt - startedAt)}ms, encode ${Math.round(now - capturedAt)}ms`,
      );
      resolve(blob);
    });
    gif.render();
  });
  return { blob, fidelity: { unsettled, total } };
}
