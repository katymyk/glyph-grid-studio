import { hash2D } from '../rng';
import { mapTone, type ToneOpts } from '../tone';
import { BAYER4, BAYER8 } from './bayer';

/**
 * The threshold-based (non-halftone) algorithms: error diffusion, ordered dither,
 * and random-threshold noise. Each turns a grayscale grid into a 1-bit grid.
 *
 * DOM-free and Sample-free: takes a plain Float32Array of 0..1 luminance, so it runs
 * under plain node for testing.
 */
export type DitherAlgo = 'floyd' | 'atkinson' | 'bayer4' | 'bayer8' | 'noise';

export interface DitherOpts {
  /**
   * SHAPING ONLY — contrast, brightness, gamma. Must NOT carry `threshold` (that is
   * `cut`, below) and must NOT carry `invert` (that is a polarity flip applied to the
   * finished bitmap at merge time). Setting either here would apply it twice: doubled
   * for the error-diffusion algos, silently cancelled for the ordered ones.
   */
  tone: ToneOpts;
  /** The binary cut, 0..1. Derive it with `inkThreshold({ threshold })`. */
  cut: number;
  seed: number;
  /** Frame index. 0 freezes the noise field to the coordinates; anything else
      re-keys it per frame (animated grain). Only the `noise` algo reads it. */
  frame: number;
  /** Noise band width. 1 matches the reference tool's half-scale grain (which
      hard-clips the tonal extremes on purpose); 2 is a full-range random dither. */
  grain: number;
  /** Serpentine (boustrophedon) scan for the error-diffusion algos: alternate rows
      run right-to-left. Not part of the classic definition, but it is the standard
      remedy for the diagonal worm artifacts Floyd–Steinberg shows on gradients. */
  serpentine: boolean;
}

/** Add error to a neighbour, discarding anything that falls off the grid. Discarding
    (rather than clamping or wrapping) is the canonical edge behaviour. */
function spread(g: Float32Array, cols: number, rows: number, x: number, y: number, e: number): void {
  if (x < 0 || x >= cols || y < 0 || y >= rows) return;
  g[y * cols + x] += e;
}

/**
 * Dither a luminance grid to 1 bit. Returns cols*rows bytes: 1 = this cell came out
 * DARK, 0 = light. Which of those gets ink is decided later, at merge time, so
 * toggling the polarity never re-runs error diffusion.
 *
 * `src` is NOT mutated. That is not a nicety: `src` is the cached Sample buffer shared
 * with ASCII mode, and error diffusion writes into its working array — mutating it
 * would corrupt every other consumer of that image for the lifetime of the tab.
 */
export function dither(
  src: Float32Array,
  cols: number,
  rows: number,
  algo: DitherAlgo,
  o: DitherOpts,
): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const T = o.cut;

  if (algo === 'floyd' || algo === 'atkinson') {
    // tone-map into a fresh working buffer, then diffuse in place
    const g = new Float32Array(cols * rows);
    for (let i = 0; i < g.length; i++) g[i] = mapTone(src[i], o.tone);
    const atkinson = algo === 'atkinson';
    for (let y = 0; y < rows; y++) {
      const rtl = o.serpentine && (y & 1) === 1;
      for (let n = 0; n < cols; n++) {
        const x = rtl ? cols - 1 - n : n;
        const i = y * cols + x;
        const old = g[i];
        const lit = old < T ? 0 : 1;
        out[i] = lit ? 0 : 1; // 1 = dark
        const err = old - lit;
        // mirror the x-offsets when scanning right-to-left
        const d = rtl ? -1 : 1;
        if (atkinson) {
          // Six neighbours at err/8 each: only 3/4 of the error is passed on. The
          // discarded quarter IS the Atkinson look (crushed extremes, high contrast)
          // — it is not a bug to be normalised away.
          const e = err / 8;
          spread(g, cols, rows, x + d, y, e);
          spread(g, cols, rows, x + 2 * d, y, e);
          spread(g, cols, rows, x - d, y + 1, e);
          spread(g, cols, rows, x, y + 1, e);
          spread(g, cols, rows, x + d, y + 1, e);
          spread(g, cols, rows, x, y + 2, e);
        } else {
          spread(g, cols, rows, x + d, y, (err * 7) / 16);
          spread(g, cols, rows, x - d, y + 1, (err * 3) / 16);
          spread(g, cols, rows, x, y + 1, (err * 5) / 16);
          spread(g, cols, rows, x + d, y + 1, (err * 1) / 16);
        }
      }
    }
    return out;
  }

  if (algo === 'bayer4' || algo === 'bayer8') {
    const M = algo === 'bayer4' ? BAYER4 : BAYER8;
    const n = M.length;
    // The matrix supplies the threshold; the tone threshold shifts the signal by the
    // same amount, which is algebraically identical and keeps one tone convention.
    const shift = 0.5 - T;
    for (let y = 0; y < rows; y++) {
      const row = M[y % n];
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        out[i] = mapTone(src[i], o.tone) + shift < row[x % n] ? 1 : 0;
      }
    }
    return out;
  }

  // noise: a random threshold per cell. Keyed on (x, y, seed) rather than drawn from
  // a sequential stream, so the grain stays nailed to the coordinates when the grid
  // resolution changes or cells get skipped.
  const amp = 0.5 * o.grain;
  const bias = T - amp / 2;
  const key = (o.seed | 0) ^ Math.imul(o.frame | 0, 0x9e3779b1);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      out[i] = mapTone(src[i], o.tone) < hash2D(x, y, key) * amp + bias ? 1 : 0;
    }
  }
  return out;
}
