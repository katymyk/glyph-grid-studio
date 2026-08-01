import { isGlyph, type Placement, type Scene, type ShapePlacement } from '../domain/scene';
import { resolveScene } from './placements';
import { assertNeverShape, diamondPoints, isBatchable, ringRadius } from './shapes';

/**
 * Paint a whole scene at time t onto a 2D context sized to scene.width/height.
 * Used by the live canvas and every raster export (PNG/GIF/sequence).
 */
export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number): number {
  const { width: W, height: H } = scene;
  ctx.clearRect(0, 0, W, H);
  // Background is a Scene concern: null = transparent. No mode paints its own.
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
    drawn += paintPlacements(ctx, layer.placements, layer.opacity);
    ctx.restore();
  }
  return drawn;
}

/** Per-element alpha, or 0 when the element is too faint or too small to matter.
    Overshoot easings can drive a size past 0, so this is a real case, not paranoia. */
function inkAlpha(p: Placement, opacity: number): number {
  const a = opacity * p.alpha;
  if (a <= 0.01) return 0;
  if (isGlyph(p)) return p.size > 0 ? a : 0;
  return p.w > 0 && p.h > 0 ? a : 0;
}

/**
 * Draw one layer's placements.
 *
 * A halftone layer is tens of thousands of identically-coloured circles, so the
 * naive save()/fill()/restore()-per-element loop is the whole cost of a frame. Runs
 * of consecutive placements that share (shape, colour, alpha) and need no rotation
 * are batched into one path or one fillStyle, which collapses a monochrome halftone
 * layer to a single fill. Everything else takes the per-element path.
 */
function paintPlacements(
  ctx: CanvasRenderingContext2D,
  placements: Placement[],
  opacity: number,
): number {
  let drawn = 0;
  let i = 0;
  while (i < placements.length) {
    const p = placements[i];
    const a = inkAlpha(p, opacity);
    if (a === 0) {
      i++;
      continue;
    }

    if (!isGlyph(p) && p.rotation === 0 && isBatchable(p.shape)) {
      const shape = p.shape;
      // Extend the run over everything sharing this element's paint state.
      let j = i + 1;
      while (j < placements.length) {
        const q = placements[j];
        if (
          isGlyph(q) ||
          q.shape !== shape ||
          q.rotation !== 0 ||
          q.color !== p.color ||
          q.alpha !== p.alpha ||
          inkAlpha(q, opacity) === 0
        ) {
          break;
        }
        j++;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (shape === 'dot') {
        ctx.beginPath();
        for (let k = i; k < j; k++) {
          const d = placements[k] as ShapePlacement;
          // moveTo starts a fresh sub-path, so dots don't join into one outline.
          ctx.moveTo(d.x + d.w / 2, d.y);
          if (d.w === d.h) ctx.arc(d.x, d.y, d.w / 2, 0, Math.PI * 2);
          else ctx.ellipse(d.x, d.y, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
          drawn++;
        }
        ctx.fill();
      } else {
        // 'square' | 'pixel' — fillRect is already cheap and skips path overhead.
        for (let k = i; k < j; k++) {
          const d = placements[k] as ShapePlacement;
          ctx.fillRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
          drawn++;
        }
      }
      i = j;
      continue;
    }

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(p.x, p.y);
    if (p.rotation) ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    if (isGlyph(p)) {
      // The font shorthand is parsed only here. One layer can hold a mix of glyph
      // and dot placements (an ascii<->halftone morph), so it must not be hoisted.
      ctx.font = `${p.weight} ${p.size}px ${p.font}`;
      ctx.fillText(p.glyph, 0, 0);
    } else {
      paintShape(ctx, p);
    }
    ctx.restore();
    drawn++;
    i++;
  }
  return drawn;
}

/**
 * Draw ONE shape in its own local space: centred on (0,0), already rotated, with
 * fillStyle and globalAlpha already set. Mirrored exactly by shapeToSVG().
 */
function paintShape(ctx: CanvasRenderingContext2D, p: ShapePlacement): void {
  const { w, h } = p;
  switch (p.shape) {
    case 'dot':
      ctx.beginPath();
      if (w === h) ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      else ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      return;

    case 'square':
    case 'pixel':
    case 'line':
      ctx.fillRect(-w / 2, -h / 2, w, h);
      return;

    case 'cross':
      // One path, not two fillRects: the arms overlap in the middle, and two separate
      // fills would composite that square twice — a visibly darker core whenever
      // alpha < 1. Nonzero winding unions them into a single composite, which is also
      // what the SVG export's grouped equivalent does.
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h); // w = arm length, h = arm thickness
      ctx.rect(-h / 2, -w / 2, h, w);
      ctx.fill();
      return;

    case 'diamond': {
      const pts = diamondPoints(w, h);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      return;
    }

    case 'ring': {
      const r = ringRadius(w, h);
      if (r === null) {
        // thickness swallowed the hole — degenerate to a solid dot
        ctx.beginPath();
        ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.strokeStyle = p.color;
      ctx.lineWidth = h;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    default:
      return assertNeverShape(p.shape);
  }
}
