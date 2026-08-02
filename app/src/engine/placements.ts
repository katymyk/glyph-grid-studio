import { resolveParam, type Param } from '../domain/params';
import { isGlyph, morphProgress, type Layer, type MorphStyle, type Placement, type Scene, type SpawnZone } from '../domain/scene';
import { getMode } from './modes';
import { getSample, gridFor } from './imageSample';

export interface ResolvedLayer {
  opacity: number;
  blendMode: GlobalCompositeOperation;
  placements: Placement[];
}

/**
 * Keep only placements allowed by the layer's spawn zone (normalized to canvas).
 *
 * Point-tested at the placement's centre, which is right for a glyph or a dot. A
 * run-merged pixel box is different: it can be as wide as the canvas, so testing its
 * midpoint would either stamp a full-width bar across the artwork or delete one that
 * genuinely overlaps the zone. Those get CLIPPED against the mask instead.
 */
function applySpawn(spawn: SpawnZone | undefined, placements: Placement[], W: number, H: number): Placement[] {
  if (!spawn || spawn.kind === 'full') return placements;
  const src = spawn.kind === 'image' ? spawn.image : spawn.mask;
  if (!src) return placements; // no mask yet — don't filter
  const cols = 200;
  const rows = Math.max(1, Math.round((200 * H) / W));
  const sample = getSample(src, gridFor(cols, rows, W, H));
  if (!sample) return placements; // decoding; repaint refilters when ready

  const inside = (x: number, y: number): boolean => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x / W) * cols)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((y / H) * rows)));
    const idx = cy * cols + cx;
    // image masks read luminance (opaque photos); brush masks read painted alpha
    const hit = spawn.kind === 'image' ? sample.lum[idx] >= 0.5 : sample.alpha[idx] / 255 >= 0.15;
    return spawn.invert ? !hit : hit;
  };

  const cellW = W / cols;
  const out: Placement[] = [];
  for (const p of placements) {
    // Only wide boxes need clipping; anything within one mask cell is already as
    // precise as the mask can express, so the cheap point test is exact for it.
    if (isGlyph(p) || p.shape !== 'pixel' || p.w <= cellW) {
      if (inside(p.x, p.y)) out.push(p);
      continue;
    }
    const left = p.x - p.w / 2;
    const right = p.x + p.w / 2;
    // Walk the mask cells the run spans by INDEX. Deriving the next boundary from the
    // current x instead would not always advance: with cellW = 9.6, x = 31 * 9.6
    // divides to 30.999999999999996, so flooring lands back on the boundary we are
    // already standing on and the walk never terminates.
    const firstCell = Math.floor(left / cellW);
    const lastCell = Math.ceil(right / cellW);
    let segStart: number | null = null;
    for (let ci = firstCell; ci < lastCell; ci++) {
      const cellL = Math.max(left, ci * cellW);
      const cellR = Math.min(right, (ci + 1) * cellW);
      if (cellR <= cellL) continue;
      if (inside((cellL + cellR) / 2, p.y)) {
        if (segStart === null) segStart = cellL;
      } else if (segStart !== null) {
        out.push({ ...p, x: (segStart + cellL) / 2, w: cellL - segStart });
        segStart = null;
      }
    }
    if (segStart !== null) out.push({ ...p, x: (segStart + right) / 2, w: right - segStart });
  }
  return out;
}

/** Deterministic 0..1 from an integer — gives each element a stable dissolve turn
    without touching the seeded RNG stream the modes use. */
function hash01(i: number): number {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** One side of a morph at handover progress `w`. `leaving` = the base mode's set. */
function handOff(list: Placement[], w: number, style: MorphStyle, leaving: boolean): Placement[] {
  if (style === 'dissolve') {
    // Each element has its own switch-over point, so one mode's elements pop out one
    // by one as the other's pop in — crisper than a crossfade over the same duration.
    return list.filter((_, i) => (leaving ? hash01(i) >= w : hash01(i) < w));
  }
  const share = leaving ? 1 - w : w;
  return list.map((p) => ({ ...p, alpha: p.alpha * share }));
}

/** Resolve one mode's params at time t and ask it for placements. */
function modePlacements(
  modeKey: string,
  params: Record<string, Param<unknown>>,
  scene: Scene,
  t: number,
): Placement[] {
  const mode = getMode(modeKey);
  const resolved: Record<string, unknown> = {};
  for (const [k, param] of Object.entries(params)) resolved[k] = resolveParam(param, t);
  return mode.placements(resolved, {
    width: scene.width,
    height: scene.height,
    time: t,
    fps: scene.fps,
    // One source for the whole stack: every layer, and both halves of a morph, screen
    // the same picture at the same clip position. That is the guarantee, and it holds
    // because they are all handed it from here rather than each carrying a copy.
    source: scene.source.image,
    srcTime: resolveParam(scene.source.srcTime, t),
  });
}

/** Placements for one layer at time t, including a mode morph if it has one. */
function layerPlacements(layer: Layer, scene: Scene, t: number): Placement[] {
  const w = layer.morph ? morphProgress(layer.morph, t) : 0;
  let out: Placement[] = [];

  if (w < 1) {
    const base = modePlacements(layer.mode, layer.params, scene, t);
    out = w <= 0 ? base : handOff(base, w, layer.morph!.style, true);
  }
  if (layer.morph && w > 0) {
    const target = modePlacements(layer.morph.mode, layer.morph.params, scene, t);
    out = out.concat(w >= 1 ? target : handOff(target, w, layer.morph.style, false));
  }
  return out;
}

/**
 * The single render path (§6): resolve every layer's params at time t, produce its
 * placements, and apply its spawn zone. Canvas painter and exporters both consume this.
 */
export function resolveScene(scene: Scene, t: number): ResolvedLayer[] {
  const out: ResolvedLayer[] = [];
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    out.push({
      opacity: resolveParam(layer.opacity, t),
      blendMode: layer.blendMode,
      placements: applySpawn(layer.spawn, layerPlacements(layer, scene, t), scene.width, scene.height),
    });
  }
  return out;
}
