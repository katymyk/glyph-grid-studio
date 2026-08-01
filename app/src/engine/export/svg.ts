import { isGlyph, type Placement, type Scene, type ShapePlacement } from '../../domain/scene';
import { resolveScene } from '../placements';
import { assertNeverShape, diamondPoints, ringRadius } from '../shapes';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const n2 = (v: number): string => v.toFixed(2);

/**
 * Attributes worth lifting off the elements and onto their <g>.
 *
 * Two reasons. Size: a halftone layer is tens of thousands of same-coloured circles,
 * so `fill` alone is ~15 bytes × N, and a dither layer also wants crispEdges at ~32
 * bytes × N. And correctness: hoisting a UNIFORM alpha makes the group composite as
 * one unit, which is what the canvas painter does when it batches same-coloured dots
 * into a single path. Left per-element, overlapping dots would double-composite in
 * SVG but not on canvas, so a half-faded halftone would export darker than it looks.
 */
interface GroupAttrs {
  fill: string | null;
  crisp: boolean;
  /** The alpha every element shares, or null if they differ. */
  alpha: number | null;
}

/** One pass over the layer to decide what can be hoisted. A morph mixes glyph and
    shape placements in a single layer, so nothing can be assumed. */
function groupAttrs(placements: Placement[]): GroupAttrs {
  if (placements.length === 0) return { fill: null, crisp: false, alpha: null };
  let fill: string | null = placements[0].color;
  let alpha: number | null = placements[0].alpha;
  let crisp = true;
  for (const p of placements) {
    if (p.color !== fill) fill = null;
    if (p.alpha !== alpha) alpha = null;
    if (isGlyph(p) || p.shape !== 'pixel') crisp = false;
    if (fill === null && alpha === null && !crisp) break;
  }
  return { fill, crisp, alpha };
}

/**
 * Canvas composite operations that have an identically-named CSS blend mode. Anything
 * else (source-in, xor, …) has no SVG equivalent and is left as normal blending rather
 * than silently rendered wrong.
 */
const CSS_BLEND = new Set([
  'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

/** Serialize a scene at time t to SVG, from the same placements the canvas paints. */
export function sceneToSVG(scene: Scene, t: number): string {
  const { width: W, height: H } = scene;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n`;
  // No background rect when scene.background is null, so a transparent-background
  // export really is transparent — matching the canvas and PNG paths.
  if (scene.background) svg += `<rect width="${W}" height="${H}" fill="${scene.background}"/>\n`;
  for (const layer of resolveScene(scene, t)) {
    const g = groupAttrs(layer.placements);
    // A hoisted uniform alpha multiplies into the group's opacity; the elements then
    // omit theirs, so the group composites once (matching the canvas).
    const groupOpacity = layer.opacity * (g.alpha ?? 1);
    svg +=
      `<g opacity="${groupOpacity}"` +
      (g.fill ? ` fill="${g.fill}"` : '') +
      (g.crisp ? ' shape-rendering="crispEdges"' : '') +
      (CSS_BLEND.has(layer.blendMode) ? ` style="mix-blend-mode:${layer.blendMode}"` : '') +
      `>\n`;
    for (const p of layer.placements) {
      // Match the painter's culls exactly, or preview and export disagree.
      if (layer.opacity * p.alpha <= 0.01) continue;
      if (isGlyph(p) ? p.size <= 0 : p.w <= 0 || p.h <= 0) continue;
      const el = isGlyph(p) ? glyphToSVG(p, g) : shapeToSVG(p, g);
      if (el) svg += el + '\n';
    }
    svg += `</g>\n`;
  }
  svg += '</svg>';
  return svg;
}

/** Shared per-element trailer: colour, opacity and rotation — each omitted when the
    enclosing group already carries it. */
function common(p: Placement, g: GroupAttrs): string {
  const deg = (p.rotation * 180) / Math.PI;
  // rotate about the placement's own centre — matches ctx.translate(x,y) + rotate()
  return (
    (g.fill ? '' : ` fill="${p.color}"`) +
    (g.alpha !== null || p.alpha >= 1 ? '' : ` opacity="${p.alpha}"`) +
    (deg ? ` transform="rotate(${n2(deg)} ${n2(p.x)} ${n2(p.y)})"` : '')
  );
}

function glyphToSVG(p: Extract<Placement, { glyph: string }>, g: GroupAttrs): string {
  const fam = p.font.split(',')[0].replace(/"/g, '');
  return (
    `<text x="${n2(p.x)}" y="${n2(p.y)}" font-family="${esc(fam)}" ` +
    `font-weight="${p.weight}" font-size="${n2(p.size)}" ` +
    `text-anchor="middle" dominant-baseline="central"${common(p, g)}>${esc(p.glyph)}</text>`
  );
}

/**
 * One shape → one SVG element. Mirrors paint.ts's paintShape() exactly: same centre,
 * same box, same geometry helpers (engine/shapes.ts), so vector and canvas can't drift.
 */
function shapeToSVG(p: ShapePlacement, g: GroupAttrs): string {
  const { w, h } = p;
  const c = common(p, g);
  const x0 = p.x - w / 2;
  const y0 = p.y - h / 2;
  // Adjacent dither runs share an exact edge; without crispEdges the shared borders
  // anti-alias into visible seams. Only needed when it wasn't hoisted to the <g>.
  const crisp = p.shape === 'pixel' && !g.crisp ? ' shape-rendering="crispEdges"' : '';

  switch (p.shape) {
    case 'dot':
      return w === h
        ? `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${n2(w / 2)}"${c}/>`
        : `<ellipse cx="${n2(p.x)}" cy="${n2(p.y)}" rx="${n2(w / 2)}" ry="${n2(h / 2)}"${c}/>`;

    case 'square':
    case 'pixel':
    case 'line':
      return `<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w)}" height="${n2(h)}"${crisp}${c}/>`;

    case 'cross':
      return (
        `<g${c}>` +
        `<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w)}" height="${n2(h)}"/>` +
        `<rect x="${n2(p.x - h / 2)}" y="${n2(p.y - w / 2)}" width="${n2(h)}" height="${n2(w)}"/>` +
        `</g>`
      );

    case 'diamond': {
      const pts = diamondPoints(w, h)
        .map(([dx, dy]) => `${n2(p.x + dx)},${n2(p.y + dy)}`)
        .join(' ');
      return `<polygon points="${pts}"${c}/>`;
    }

    case 'ring': {
      const r = ringRadius(w, h);
      if (r === null) return `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${n2(w / 2)}"${c}/>`;
      // A stroke, so the group's hoisted `fill` must be explicitly cancelled.
      return (
        `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${n2(r)}" fill="none" ` +
        `stroke="${p.color}" stroke-width="${n2(h)}"` +
        (g.alpha !== null || p.alpha >= 1 ? '' : ` opacity="${p.alpha}"`) +
        `/>`
      );
    }

    default:
      return assertNeverShape(p.shape);
  }
}
