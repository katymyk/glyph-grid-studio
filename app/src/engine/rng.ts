/**
 * Deterministic mulberry32 PRNG (ported from v1). All randomness in the render
 * path must flow through this so a given seed always reproduces the same layout.
 */
export function makeRNG(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 0..1 from a 2-D coordinate + seed (murmur3 fmix32 avalanche).
 *
 * ORDER-INDEPENDENT by construction: the value at (x, y) never depends on how many
 * cells were visited before it. `makeRNG` returns a *stream*, so its n-th draw
 * depends on the draw count so far — which means any loop that culls cells, or whose
 * bounds move with a param, reshuffles its whole random field when that param
 * nudges. For a halftone screen (bounds move with angle/cell, sites get culled) or a
 * noise dither (cells get skipped) that shows up as the pattern boiling while you
 * drag a slider. Keyed on position instead, the field is nailed to the coordinates.
 *
 * `buildCells` can keep using the stream because its bounds are fixed and it never
 * culls; anything with moving bounds must use this.
 */
export function hash2D(x: number, y: number, seed: number, stream = 0): number {
  // The trailing constant is load-bearing: without it every input being 0 gives
  // h = 0, which survives the whole avalanche and returns exactly 0 — a dead spot
  // at the origin site of an unseeded screen.
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^
      Math.imul(y | 0, 0x165667b1) ^
      Math.imul(((seed | 0) + stream) | 0, 0x9e3779b1) ^
      0x85ebca6b) |
    0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
