import JSZip from 'jszip';
import type { Scene } from '../../domain/scene';
import { frameCount } from '../../domain/timeline';
import { paintSettled, type ExportFidelity } from './frames';

/**
 * Render the scene across one loop as a zip of lossless PNG frames (for After Effects).
 *
 * Reports how many frames were written WITHOUT their real source data. Discarding that
 * (which this used to do) is how a video sequence came out with duplicated frames and no
 * indication of it: the zip has the right frame count either way.
 */
export async function sceneToSequence(
  scene: Scene,
  onProgress?: (p: number) => void,
): Promise<{ blob: Blob; fidelity: ExportFidelity }> {
  const fps = scene.fps || 25;
  const total = frameCount(scene);
  const zip = new JSZip();
  const off = document.createElement('canvas');
  off.width = scene.width;
  off.height = scene.height;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // paintSettled, not paintScene: a video frame still seeking (or an image still
  // decoding) would otherwise be written to the zip as a blank or a duplicate.
  let unsettled = 0;
  for (let f = 0; f < total; f++) {
    if (!(await paintSettled(ctx, scene, f / fps)).settled) unsettled++;
    const blob = await new Promise<Blob>((resolve, reject) =>
      off.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    zip.file(`frame_${String(f).padStart(4, '0')}.png`, await blob.arrayBuffer());
    onProgress?.((f + 1) / total);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), fidelity: { unsettled, total } };
}
