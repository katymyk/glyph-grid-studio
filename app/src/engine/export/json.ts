import type { Scene } from '../../domain/scene';
import { resolveScene } from '../placements';

/** Export scene coordinates/items at time t (for After Effects etc.). */
export function sceneToJSON(scene: Scene, t: number): string {
  const data = {
    canvas: { width: scene.width, height: scene.height },
    fps: scene.fps,
    background: scene.background,
    layers: resolveScene(scene, t).map((L, i) => ({
      index: i,
      opacity: L.opacity,
      blendMode: L.blendMode,
      items: L.placements.map((p) => ({
        x: +p.x.toFixed(2),
        y: +p.y.toFixed(2),
        size: +p.size.toFixed(2),
        glyph: p.glyph,
        color: p.color,
        rotation: +((p.rotation * 180) / Math.PI).toFixed(2),
        alpha: p.alpha,
      })),
    })),
  };
  return JSON.stringify(data, null, 2);
}
