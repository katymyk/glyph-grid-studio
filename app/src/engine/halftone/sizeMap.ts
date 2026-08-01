import { COVER_R, type Lattice } from './screen';

/**
 * Darkness → dot size.
 *
 * The subtle part of halftoning: tone is reproduced by how much INK AREA covers the
 * paper, not by radius. So a dot whose radius is proportional to darkness prints
 * midtones at a quarter of their intended density. The three mappings here are the
 * three defensible answers.
 *
 * DOM-free, so it runs under plain node for testing.
 */
export type SizeMap =
  | 'area' // radius ∝ √dark — disc AREA is linear in darkness. The classic.
  | 'coverage' // measured ink coverage is linear in darkness — tone-accurate.
  | 'linear'; // radius ∝ dark — thin, graphic, deliberately light in the midtones.

/** Circular-segment area: the part of a disc of radius r beyond a chord at distance h. */
function seg(r: number, h: number): number {
  if (h >= r) return 0;
  return r * r * Math.acos(h / r) - h * Math.sqrt(r * r - h * h);
}

/** Overlap area of two discs of radius r whose centres are distance d apart. */
function lens(d: number, r: number): number {
  if (d >= 2 * r) return 0;
  return 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
}

/**
 * Ink coverage (0..1) of a square lattice of radius-`a` discs at unit pitch.
 * Valid for 0 ≤ a ≤ 1/√2, where `coverSquare(1/√2) === 1` — the discs exactly tile.
 * Beyond a = 0.5 neighbours overlap, which is why this is not simply πa².
 */
export function coverSquare(a: number): number {
  if (a <= 0) return 0;
  if (a >= COVER_R.square) return 1;
  return Math.PI * a * a - 2 * lens(1, a);
}

/** Ink coverage (0..1) of a triangular (hex) lattice at unit pitch, 0 ≤ a ≤ 1/√3. */
export function coverHex(a: number): number {
  if (a <= 0) return 0;
  if (a >= COVER_R.hex) return 1;
  // six neighbours at distance 1 → six segments beyond the half-way chord,
  // normalised by the hex cell's area (√3/2 at unit pitch)
  return (Math.PI * a * a - 6 * seg(a, 0.5)) / (Math.sqrt(3) / 2);
}

export function coverOf(lattice: Lattice): (a: number) => number {
  return lattice === 'hex' ? coverHex : coverSquare;
}

const LUT_N = 257; // 257 entries → worst-case ink error under 0.1 percentage points

/**
 * Inverse of `coverSquare`/`coverHex` as a lookup table: coverage → radius in cells.
 * Built by bisection once per lattice (there is no closed form for the inverse).
 */
export function coverageLUT(lattice: Lattice): Float64Array {
  const cover = coverOf(lattice);
  const aMax = COVER_R[lattice];
  const t = new Float64Array(LUT_N);
  for (let k = 0; k < LUT_N; k++) {
    const target = k / (LUT_N - 1);
    let lo = 0;
    let hi = aMax;
    for (let it = 0; it < 40; it++) {
      const m = (lo + hi) / 2;
      if (cover(m) < target) lo = m;
      else hi = m;
    }
    t[k] = (lo + hi) / 2;
  }
  return t;
}

/** Linear-interpolated LUT read. Returns a radius in CELLS. */
export function lutLookup(t: Float64Array, dark: number): number {
  const n = t.length - 1;
  const f = (dark < 0 ? 0 : dark > 1 ? 1 : dark) * n;
  const i = f | 0;
  return i >= n ? t[n] : t[i] + (t[i + 1] - t[i]) * (f - i);
}

/**
 * Darkness (0..1) → dot RADIUS in px.
 *
 * `rMax` is the radius at full darkness (cell × the lattice cover radius × dot
 * scale). For 'coverage' the LUT already yields the tone-correct radius in cells, so
 * the scale is applied to that instead — meaning 100% dot scale is exactly
 * tone-accurate and anything above it is a deliberate ink push.
 */
export function dotRadius(
  dark: number,
  rMax: number,
  map: SizeMap,
  lut: Float64Array,
  cell: number,
  scale: number,
): number {
  if (map === 'linear') return rMax * dark;
  if (map === 'coverage') return lutLookup(lut, dark) * cell * scale;
  return rMax * Math.sqrt(dark);
}

/**
 * The darkness below which a dot would be smaller than `minPx` — so it can be culled
 * before allocating anything. Inverts each mapping.
 *
 * Expressed as a pixel floor rather than a fixed darkness cut, because a fixed cut
 * means very different things at cell 6 and cell 32: it would visibly clip the
 * shadows of a coarse screen while doing nothing to a fine one.
 */
export function darkFloor(
  minPx: number,
  rMax: number,
  map: SizeMap,
  lattice: Lattice,
  cell: number,
  scale: number,
): number {
  if (minPx <= 0) return 0;
  if (map === 'coverage') {
    const a = minPx / (cell * Math.max(1e-6, scale));
    return coverOf(lattice)(Math.min(COVER_R[lattice], a));
  }
  if (rMax <= 0) return 1;
  const ratio = minPx / rMax;
  return map === 'linear' ? ratio : ratio * ratio;
}
