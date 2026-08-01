/**
 * Ordered-dither (Bayer) threshold matrices, generated rather than hardcoded so the
 * 4×4 and 8×8 provably come from the same rule.
 *
 * The recurrence is M₂ₙ = [[4Mₙ+0, 4Mₙ+2], [4Mₙ+3, 4Mₙ+1]] — the quadrant offsets
 * are 0,2,3,1, NOT raster order, which is the detail that makes the result the
 * canonical matrix instead of a plausible-looking wrong one.
 *
 * DOM-free, so it runs under plain node for testing.
 */

/** Raw integer matrix, values 0..n²-1, each appearing exactly once. */
export function bayerInts(n: number): number[][] {
  let m: number[][] = [[0]];
  while (m.length < n) {
    const s = m.length;
    const N = s * 2;
    const out: number[][] = [];
    for (let y = 0; y < N; y++) {
      out[y] = [];
      for (let x = 0; x < N; x++) {
        const add = [0, 2, 3, 1][(y < s ? 0 : 2) + (x < s ? 0 : 1)];
        out[y][x] = m[y % s][x % s] * 4 + add;
      }
    }
    m = out;
  }
  return m;
}

/**
 * Thresholds normalised to 0..1. The `+0.5` centring matters: without it the first
 * entry is exactly 0, and a pure-black pixel would flip to white. With it, thresholds
 * never reach 0 or 1, so absolute black and absolute white both survive.
 *
 * `max` is derived as n² — a hardcoded 64 would silently break any other size.
 */
function bayerNorm(n: number): number[][] {
  const max = n * n;
  return bayerInts(n).map((r) => r.map((v) => (v + 0.5) / max));
}

export const BAYER4 = bayerNorm(4);
export const BAYER8 = bayerNorm(8);
