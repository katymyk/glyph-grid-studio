import { makeRNG } from './rng';

/** One grid cell with stable per-cell random values (ported from v1 buildCells). */
export interface Cell {
  c: number;
  r: number;
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  rFill: number;
  rGlyph: number;
  rColor: number;
  rSize: number;
  rPx: number;
  rPy: number;
  rRot: number;
  rPhase: number;
}

/**
 * How many whole cells of `cell` px fit across a W×H canvas.
 *
 * ASCII sizes its grid this way — one number, "how big is a character cell" — rather
 * than by a column and a row count, which have to be held in the canvas's ratio by hand
 * or the picture squashes. Rounding to whole cells means the delivered pitch is up to
 * half a pixel off what was asked for; the cells stay uniform and the grid stays exactly
 * canvas-shaped, which matters more than hitting the request to the pixel.
 */
export function gridForCell(cell: number, width: number, height: number): { cols: number; rows: number } {
  const px = cell > 0 ? cell : 1;
  return {
    cols: Math.max(1, Math.round(width / px)),
    rows: Math.max(1, Math.round(height / px)),
  };
}

export function buildCells(
  cols: number,
  rows: number,
  width: number,
  height: number,
  seed: number,
): Cell[] {
  const rng = makeRNG(seed);
  const cells: Cell[] = [];
  const cw = width / cols;
  const ch = height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        c,
        r,
        cx: (c + 0.5) * cw,
        cy: (r + 0.5) * ch,
        cw,
        ch,
        rFill: rng(),
        rGlyph: rng(),
        rColor: rng(),
        rSize: rng(),
        rPx: rng() * 2 - 1,
        rPy: rng() * 2 - 1,
        rRot: rng() * 2 - 1,
        rPhase: rng(),
      });
    }
  }
  return cells;
}
