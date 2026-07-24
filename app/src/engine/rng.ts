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
