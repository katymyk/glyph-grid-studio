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
