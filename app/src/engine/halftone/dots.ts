import type { ShapeKind, ShapePlacement } from '../../domain/scene';
import { hash2D } from '../rng';
import { inkFromLum, type ToneOpts } from '../tone';
import { alphaAt, lumAt, rgbAt, type GrayField } from './field';
import { COVER_R, forEachSite, screen, type Lattice } from './screen';
import { coverageLUT, darkFloor, dotRadius, type SizeMap } from './sizeMap';

/**
 * Building the dot screen: given a sampled source and a screen description, produce
 * one placement per visible dot.
 *
 * Kept separate from the mode (which owns the DOM-side sampling) so this whole
 * pipeline is DOM-free and runs under plain node for testing.
 */
export interface DotConfig {
  /** The pitch to use — already passed through the element cap. */
  cell: number;
  angle: number;
  lattice: Lattice;
  shape: ShapeKind;
  /** Dot size at full darkness, as a fraction (1 = exactly tiles at full black). */
  scale: number;
  sizeMap: SizeMap;
  /** Ink gain: multiplies darkness, so midtones fill further. 1 = neutral. */
  gain: number;
  /** Cull dots whose radius would fall below this many px. */
  minDot: number;
  /** Positional jitter as a fraction of half a cell. */
  jitter: number;
  /** Stroke/arm thickness as a fraction of the dot's extent. Only the shapes that
      have a thickness distinct from their extent read it (ring, cross, line). */
  thickness: number;
  tone: ToneOpts;
  /** Ink colour, used unless `useImgColors`. */
  color: string;
  useImgColors: boolean;
  seed: number;
}

/** Coverage LUTs are lattice-dependent and cost a few thousand bisections to build,
    so they are memoised rather than rebuilt every frame. */
const lutCache = new Map<Lattice, Float64Array>();
function lutFor(lattice: Lattice): Float64Array {
  let t = lutCache.get(lattice);
  if (!t) {
    t = coverageLUT(lattice);
    lutCache.set(lattice, t);
  }
  return t;
}

/**
 * The w×h box for one mark of extent `d`.
 *
 * Three of the shapes are defined by an extent AND a thickness: a ring's `h` is its
 * stroke width, a cross's `h` is its arm width, a bar's `h` is its depth. Handing them
 * `w === h` collapses all three — the ring's hole closes into a solid disc and the
 * cross and bar become squares — so they need the thickness applied here rather than
 * silently degenerating.
 */
function boxFor(shape: ShapeKind, d: number, thickness: number): { w: number; h: number } {
  if (shape !== 'ring' && shape !== 'cross' && shape !== 'line') return { w: d, h: d };
  // Keep a visible hole/arm: never thinner than half a pixel, never thicker than 90%
  // of the extent (at which point a ring is a disc anyway).
  const t = Math.max(0.5, Math.min(d * 0.9, d * thickness));
  return { w: d, h: t };
}

export function buildDots(
  fieldData: GrayField,
  W: number,
  H: number,
  cfg: DotConfig,
): ShapePlacement[] {
  const { cell, lattice } = cfg;
  const rMax = cell * COVER_R[lattice] * cfg.scale * 1.02; // 1.02 keeps full black solid
  const jitPx = cfg.jitter * 0.5 * cell; // capped at half a pitch, so dots keep their order
  const lut = lutFor(lattice);
  const floor = darkFloor(cfg.minDot, rMax, cfg.sizeMap, lattice, cell, cfg.scale);
  // The margin must reach as far as any dot's ink can, or edge dots get dropped.
  const scr = screen(W, H, cell, cfg.angle, lattice, rMax + jitPx);

  const out: ShapePlacement[] = [];
  forEachSite(scr, W, H, (x, y, i, j) => {
    // Jitter is keyed on the lattice indices, never drawn from a sequential stream:
    // the site bounds move with angle/cell and sites get culled, so a stream would
    // reshuffle the entire pattern as you drag a slider.
    // Argument order matters: hash2D(x, y, seed, stream) folds `stream` into the seed,
    // so passing (seed, i, j) would make the y-jitter of one row identical to the
    // x-jitter of the next — one field shifted by a row, not two independent ones.
    const px = jitPx ? x + (hash2D(i, j, cfg.seed, 0) * 2 - 1) * jitPx : x;
    const py = jitPx ? y + (hash2D(i, j, cfg.seed, 1) * 2 - 1) * jitPx : y;
    const nx = px / W;
    const ny = py / H;
    // Source alpha gates the dot. Without this a transparent PNG halftones its empty
    // regions into solid ink, because luminance is computed from un-premultiplied RGB
    // and a transparent pixel reads as pure black.
    const a = alphaAt(fieldData, nx, ny);
    if (a < 0.02) return;
    let dark = inkFromLum(lumAt(fieldData, nx, ny), cfg.tone) * cfg.gain * a;
    if (dark > 1) dark = 1;
    if (dark <= floor) return; // cull before allocating anything
    const d = dotRadius(dark, rMax, cfg.sizeMap, lut, cell, cfg.scale) * 2;
    if (d <= 0) return;
    const { w, h } = boxFor(cfg.shape, d, cfg.thickness);
    out.push({
      shape: cfg.shape,
      x: px,
      y: py,
      w,
      h,
      color: cfg.useImgColors ? rgbAt(fieldData, nx, ny) : cfg.color,
      rotation: 0,
      alpha: 1,
    });
  });
  return out;
}
