import type { Scene } from '../domain/scene';
import { resolveScene } from './placements';

/**
 * Paint a whole scene at time t onto a 2D context sized to scene.width/height.
 * Used by the live canvas and every raster export (PNG/GIF/sequence).
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  t: number,
): number {
  const { width: W, height: H } = scene;
  ctx.clearRect(0, 0, W, H);
  if (scene.background) {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, W, H);
  }

  let drawn = 0;
  for (const layer of resolveScene(scene, t)) {
    ctx.save();
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of layer.placements) {
      const a = layer.opacity * p.alpha;
      if (a <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      if (p.rotation) ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.font = `${p.weight} ${p.size}px ${p.font}`;
      ctx.fillText(p.glyph, 0, 0);
      ctx.restore();
      drawn++;
    }
    ctx.restore();
  }
  return drawn;
}
