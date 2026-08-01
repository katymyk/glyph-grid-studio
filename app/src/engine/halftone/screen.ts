/**
 * Halftone screen geometry — the lattice of dot sites.
 *
 * A halftone screen is a regular lattice rotated about the canvas centre. The whole
 * job of this module is to enumerate exactly the sites whose ink can land on the
 * canvas, for any cell size and any angle, without missing edge dots and without
 * scanning a large empty margin.
 *
 * DOM-free and Sample-free on purpose, so it runs under plain node for testing.
 */

/** Lattice kind. `hex` offsets alternate rows by half a cell — the classic
    newspaper screen, where every neighbour sits at the same distance. */
export type Lattice = 'square' | 'hex';

/** Row pitch as a multiple of `cell`. √3/2 makes a hex lattice truly triangular
    (all six neighbours exactly `cell` apart) rather than a squashed grid. */
export const ROW_PITCH: Record<Lattice, number> = { square: 1, hex: Math.sqrt(3) / 2 };

/**
 * Radius, in cells, at which discs exactly tile the plane — the Voronoi
 * circumradius. At this radius full darkness renders as solid ink with no gaps,
 * which is what makes it the right normaliser for dot size. It differs per lattice
 * (a hex cell's circumradius is smaller), so reusing the square value for hex would
 * overlap well past solid and crush the shadows.
 */
export const COVER_R: Record<Lattice, number> = {
  square: Math.SQRT1_2, // 0.7071 — half-diagonal of a square cell
  hex: 1 / Math.sqrt(3), // 0.5774 — circumradius of a hexagonal cell
};

export interface Screen {
  cos: number;
  sin: number;
  cx: number;
  cy: number;
  cell: number;
  rowPitch: number;
  /** x-shift of odd rows, in lattice units (0 for square, 0.5 for hex). */
  offset: number;
  iMin: number;
  iMax: number;
  jMin: number;
  jMax: number;
  /** px; a site further outside the canvas than this cannot deposit visible ink. */
  margin: number;
}

/**
 * Build the site bounds for a screen.
 *
 * The bounds are the axis-aligned bounding box, *in lattice space*, of the canvas
 * rectangle inflated by `margin` — obtained by inverse-rotating the four corners.
 * That is exact to within one ring at every angle and aspect ratio.
 *
 * (The obvious alternative — one square index window sized for the 45° worst case,
 * `ceil(diagonal / 2 / cell)` — is what the tool this mode is modelled on does. It
 * over-scans by up to 2.3× at shallow angles, and its safety margin turns out to
 * depend on an unstated bound: it starts silently dropping corner dots once the ink
 * reach exceeds √2 cells, which a large dot scale plus jitter can do.)
 *
 * `margin` MUST be the largest distance a site's ink can reach back onto the canvas:
 * `maxRadius + maxJitter`. Too small drops edge dots; too large only costs scan time.
 */
export function screen(
  W: number,
  H: number,
  cell: number,
  angleDeg: number,
  lattice: Lattice,
  margin: number,
): Screen {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ac = Math.abs(cos);
  const as = Math.abs(sin);
  const rowPitch = cell * ROW_PITCH[lattice];
  const offset = lattice === 'hex' ? 0.5 : 0;
  const A = W / 2 + margin;
  const B = H / 2 + margin;
  const ri = Math.ceil((A * ac + B * as) / cell);
  const rj = Math.ceil((A * as + B * ac) / rowPitch);
  return {
    cos,
    sin,
    cx: W / 2,
    cy: H / 2,
    cell,
    rowPitch,
    offset,
    margin,
    // offset rows shift by +0.5 cell, so the low side needs one extra ring
    iMin: -ri - (offset ? 1 : 0),
    iMax: ri,
    jMin: -rj,
    jMax: rj,
  };
}

/**
 * The canonical site loop. Everything that walks the screen goes through here, so
 * lattice geometry is decided in exactly one place.
 *
 * `visit` receives the site's canvas position plus its lattice indices — the indices
 * matter because per-site randomness must be keyed on them (see `hash2D`), never
 * drawn from a sequential stream whose order changes when sites are culled.
 */
export function forEachSite(
  s: Screen,
  W: number,
  H: number,
  visit: (x: number, y: number, i: number, j: number) => void,
): void {
  const m = s.margin;
  for (let j = s.jMin; j <= s.jMax; j++) {
    const ly = j * s.rowPitch;
    // (j & 1) is 1 for odd negatives too, unlike (j % 2 === 1)
    const rowShift = s.offset && j & 1 ? s.offset : 0;
    for (let i = s.iMin; i <= s.iMax; i++) {
      const lx = (i + rowShift) * s.cell;
      const x = lx * s.cos - ly * s.sin + s.cx;
      if (x < -m || x > W + m) continue;
      const y = lx * s.sin + ly * s.cos + s.cy;
      if (y < -m || y > H + m) continue;
      visit(x, y, i, j);
    }
  }
}

/** How many sites a screen of this pitch puts on the canvas. */
export function siteCount(W: number, H: number, cell: number, lattice: Lattice): number {
  return Math.round((W * H) / (cell * cell * ROW_PITCH[lattice]));
}

/**
 * The cell size the screen will ACTUALLY use once the element cap applies, returning
 * `cell` unchanged when it is already under budget.
 *
 * Why a cap at all: the canvas can be 8000px, and cell size is a free slider, so
 * "cell 3 on a 4K canvas" asks for 900k dots per repaint — and the stage repaints
 * synchronously on every slider tick. Why *this* cap:
 *  - it is pure and exported, so the sidebar can show the user the effective value
 *    and the real dot count. A cap you cannot see is indistinguishable from a bug.
 *  - one cap for preview AND export. A looser export cap would mean the PNG doesn't
 *    match the canvas, which is the drift the single-render-path rule forbids.
 *  - it returns a float, so animating `cell` through the boundary is smooth rather
 *    than snapping (while capped, `cell` keyframes simply have no visible effect —
 *    which is exactly what the readout tells you).
 */
export function effectiveCell(
  W: number,
  H: number,
  cell: number,
  lattice: Lattice,
  maxElements: number,
): number {
  const need = Math.sqrt((W * H) / (ROW_PITCH[lattice] * Math.max(1, maxElements)));
  return cell >= need ? cell : need;
}

/** The same guard for the dither family, where the grid is cells of `pixel` px. */
export function effectivePixelSize(
  W: number,
  H: number,
  pixel: number,
  maxElements: number,
): number {
  const need = Math.sqrt((W * H) / Math.max(1, maxElements));
  return pixel >= need ? pixel : need;
}
