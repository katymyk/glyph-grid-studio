import JSZip from 'jszip';
import type { Scene } from '../../domain/scene';
import { paintScene } from '../paint';

/** Render the scene across one loop as a zip of lossless PNG frames (for After Effects). */
export async function sceneToSequence(scene: Scene, onProgress?: (p: number) => void): Promise<Blob> {
  const fps = scene.fps || 25;
  const total = Math.max(1, Math.round(fps * scene.duration));
  const zip = new JSZip();
  const off = document.createElement('canvas');
  off.width = scene.width;
  off.height = scene.height;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  for (let f = 0; f < total; f++) {
    paintScene(ctx, scene, f / fps);
    const blob = await new Promise<Blob>((resolve, reject) =>
      off.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    zip.file(`frame_${String(f).padStart(4, '0')}.png`, await blob.arrayBuffer());
    onProgress?.((f + 1) / total);
    await new Promise((r) => setTimeout(r, 0));
  }
  return await zip.generateAsync({ type: 'blob' });
}
