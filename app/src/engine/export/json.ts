import { isGlyph, type Scene } from '../../domain/scene';
import { resolveScene } from '../placements';

/**
 * Export scene coordinates/items at time t (for After Effects etc.).
 *
 * x/y is the element's CENTRE. Every item carries `shape`, so an importer can
 * branch: `'glyph'` items have `size` + `glyph` (what this file emitted before
 * halftone existed), geometric items have `shape` + `w` + `h` instead.
 */
export function sceneToJSON(scene: Scene, t: number): string {
  const data = {
    canvas: { width: scene.width, height: scene.height },
    fps: scene.fps,
    background: scene.background,
    layers: resolveScene(scene, t).map((L, i) => ({
      index: i,
      opacity: L.opacity,
      blendMode: L.blendMode,
      // Same culls the painter and the SVG exporter apply, or the JSON would list
      // elements that neither the preview nor the vector export contains.
      items: L.placements
        .filter(
          (p) =>
            L.opacity * p.alpha > 0.01 && (isGlyph(p) ? p.size > 0 : p.w > 0 && p.h > 0),
        )
        .map((p) => {
          const base = {
            x: +p.x.toFixed(2),
            y: +p.y.toFixed(2),
            color: p.color,
            rotation: +((p.rotation * 180) / Math.PI).toFixed(2),
            alpha: p.alpha,
          };
          return isGlyph(p)
            ? { ...base, shape: 'glyph', size: +p.size.toFixed(2), glyph: p.glyph }
            : { ...base, shape: p.shape, w: +p.w.toFixed(2), h: +p.h.toFixed(2) };
        }),
    })),
  };
  return JSON.stringify(data, null, 2);
}
