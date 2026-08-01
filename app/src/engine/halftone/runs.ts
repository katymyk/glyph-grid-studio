import type { ShapePlacement } from '../../domain/scene';
import { dither, type DitherAlgo, type DitherOpts } from './dither';
import type { GrayField } from './field';

/**
 * Turn a 1-bit dither grid into placements.
 *
 * A 480×270 grid is 129,600 cells; emitting one element per cell would be wasteful
 * on canvas and unusable as SVG. Instead, horizontal runs of same-state cells merge
 * into a single box. On photographic sources that is a 5–20× reduction; on flat
 * regions under an ordered dither it is 1× (a perfect checkerboard has no runs to
 * merge), which is the case any element cap has to be sized for.
 *
 * Only INK is ever emitted — the other state produces nothing, so `scene.background`
 * shows through. That is what makes a transparent-background dither possible at all.
 * (The tool this is modelled on always paints an opaque background rect and draws
 * whichever colour is in the minority. Worth noting that its stated reason — smaller
 * files — does not hold: the number of runs of a binary row is the same either way,
 * to within one per row, however lopsided the cell counts are.)
 *
 * The merge is done here, in the mode, rather than in the SVG exporter, so canvas,
 * SVG and JSON all get the identical element list.
 *
 * DOM-free, so it runs under plain node for testing.
 */
/**
 * Dither a sampled source and emit the ink as run-merged boxes.
 *
 * DOM-free (it takes an already-sampled field), so the whole threshold pipeline runs
 * under plain node for testing.
 */
/** Bin value for "the source has nothing here". Deliberately neither 0 nor 1: the two
    real states are dark/light and `invert` swaps which of them gets ink, so a
    transparent cell parked in either of them would become ink at one polarity. */
const NO_SOURCE = 2;

export function buildDither(
  fieldData: GrayField,
  W: number,
  H: number,
  algo: DitherAlgo,
  opts: DitherOpts,
  invert: boolean,
  color: string,
): ShapePlacement[] {
  const { cols, rows } = fieldData;
  const bin = dither(fieldData.lum, cols, rows, algo, opts);
  // Transparent source pixels must not produce ink at EITHER polarity. Luminance
  // ignores alpha (canvas pixel data is un-premultiplied, so a transparent pixel
  // reads as pure black), so gate explicitly — into a third state, see NO_SOURCE.
  for (let i = 0; i < bin.length; i++) if (fieldData.alpha[i] < 5) bin[i] = NO_SOURCE;
  // `invert` is a polarity flip on the finished bitmap, choosing which state gets ink
  // — not a tone negation. Negating the input instead would give a genuinely
  // different picture under an ordered matrix (the complementary screen, not the
  // inverse) and would force a re-dither on every toggle.
  const out: ShapePlacement[] = [];
  mergeRuns(bin, cols, rows, W, H, invert ? 0 : 1, color, out);
  return out;
}

export function mergeRuns(
  bin: Uint8Array,
  cols: number,
  rows: number,
  W: number,
  H: number,
  ink: 0 | 1,
  color: string,
  out: ShapePlacement[],
): void {
  for (let r = 0; r < rows; r++) {
    // Rounded CUMULATIVE boundaries, not r * cellHeight. This is what makes adjacent
    // boxes share an exact edge even when rows doesn't divide H — so there are no
    // anti-aliased seams on canvas, no hairline gaps in SVG, and no sub-pixel drift
    // accumulating across hundreds of rows.
    const y0 = Math.round((r * H) / rows);
    const y1 = Math.round(((r + 1) * H) / rows);
    if (y1 <= y0) continue; // degenerate row (more rows than pixels)
    const h = y1 - y0;
    const base = r * cols;
    let c = 0;
    while (c < cols) {
      if (bin[base + c] !== ink) {
        c++;
        continue;
      }
      const c0 = c;
      do c++;
      while (c < cols && bin[base + c] === ink);
      const x0 = Math.round((c0 * W) / cols);
      const x1 = Math.round((c * W) / cols);
      if (x1 <= x0) continue; // degenerate run
      out.push({
        shape: 'pixel',
        // (x, y) is the CENTRE for every placement — the spawn-zone test, canvas
        // rotation and the SVG rotate() pivot all rely on that being true.
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        w: x1 - x0,
        h,
        color,
        rotation: 0,
        alpha: 1,
      });
    }
  }
}
