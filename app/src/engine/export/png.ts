import type { Scene } from '../../domain/scene';
import { paintScene } from '../paint';

/** Render the scene at time t to a PNG blob at `scale`× resolution. */
export async function sceneToPNGBlob(scene: Scene, t: number, scale = 2): Promise<Blob> {
  const off = document.createElement('canvas');
  off.width = scene.width * scale;
  off.height = scene.height * scale;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.scale(scale, scale);
  paintScene(ctx, scene, t);
  return await new Promise<Blob>((resolve, reject) =>
    off.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}
