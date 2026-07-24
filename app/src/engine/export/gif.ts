import GIF from 'gif.js';
import workerUrl from 'gif.js/dist/gif.worker.js?url';
import type { Scene } from '../../domain/scene';
import { paintScene } from '../paint';

/** Render the scene across one loop into an animated GIF. Frame times step by 1/fps.
    The worker is bundled + same-origin (via ?url), so no cross-origin worker issue. */
export async function sceneToGIF(scene: Scene, onProgress?: (p: number) => void): Promise<Blob> {
  const fps = scene.fps || 25;
  const total = Math.max(1, Math.round(fps * scene.duration));
  const delay = Math.round(1000 / fps);
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: scene.width,
    height: scene.height,
    workerScript: workerUrl,
  });
  const off = document.createElement('canvas');
  off.width = scene.width;
  off.height = scene.height;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  for (let f = 0; f < total; f++) {
    paintScene(ctx, scene, f / fps);
    gif.addFrame(ctx, { copy: true, delay });
    onProgress?.(((f + 1) / total) * 0.5); // capture = first half of progress
    await new Promise((r) => setTimeout(r, 0));
  }
  return await new Promise<Blob>((resolve) => {
    gif.on('progress', (p) => onProgress?.(0.5 + p * 0.5)); // encode = second half
    gif.on('finished', (blob) => resolve(blob));
    gif.render();
  });
}
