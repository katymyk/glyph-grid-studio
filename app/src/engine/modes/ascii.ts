import { konst, type Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';
import { buildCells, gridForCell } from '../cells';
import { fontStack } from '../fonts';
import { gridFor, sampleSource } from '../imageSample';
import { inkFromLum, keepsInk } from '../tone';
import type { ModeContext, RenderMode } from './types';

export interface AsciiParams {
  ramp: string;
  invert: boolean;
  useImgColors: boolean;
  contrast: number; // 20..300 (%)
  brightness: number; // -100..100
  cutLights: number; // 0..100 — drop the palest cells
  cutDarks: number; // 0..100 — drop the densest cells
  /** Character cell in px. THE grid control: columns and rows are derived from it and
      the canvas, so the grid can never be off the canvas's ratio. */
  cell: number;
  density: number;
  /** Type size as a percentage of the cell, so resizing the cell rescales the type
      with it instead of leaving the glyphs stranded at their old px. */
  glyphScale: number;
  seed: number;
  fontKey: string;
  weight: string;
  palette: string[];
}

function asciiDefaults(): AsciiParams {
  return {
    ramp: ' .:-=+*#%@',
    invert: false,
    useImgColors: false,
    contrast: 100,
    brightness: 0,
    cutLights: 0,
    cutDarks: 0,
    cell: 24, // 80 × 45 on a 1920×1080 canvas — the grid this mode shipped with
    density: 100,
    glyphScale: 67, // ≈16px in a 24px cell
    seed: 1,
    fontKey: 'mono',
    weight: '400',
    palette: ['#2f43fa', '#0a0a0a'],
  };
}

/** Ink demand → ramp glyph. Tone lives in engine/tone.ts, shared with halftone mode,
    so the same picture reads the same in both (and in a morph between them). */
function rampChar(ink: number, ramp: string): string {
  let ri = Math.round(ink * (ramp.length - 1));
  ri = ri < 0 ? 0 : ri > ramp.length - 1 ? ramp.length - 1 : ri;
  return ramp[ri];
}

function read(r: Record<string, unknown>): AsciiParams {
  const d = asciiDefaults();
  const g = <T,>(k: keyof AsciiParams, f: T): T => (r[k as string] as T) ?? f;
  return {
    ramp: g('ramp', d.ramp),
    invert: g('invert', d.invert),
    useImgColors: g('useImgColors', d.useImgColors),
    contrast: g('contrast', d.contrast),
    brightness: g('brightness', d.brightness),
    cutLights: g('cutLights', d.cutLights),
    cutDarks: g('cutDarks', d.cutDarks),
    cell: g('cell', d.cell),
    density: g('density', d.density),
    glyphScale: g('glyphScale', d.glyphScale),
    seed: g('seed', d.seed),
    fontKey: g('fontKey', d.fontKey),
    weight: g('weight', d.weight),
    palette: g('palette', d.palette),
  };
}

export const asciiMode: RenderMode = {
  key: 'ascii',
  label: 'ASCII',
  readsSource: true,

  defaultParams(): Record<string, Param<unknown>> {
    const d = asciiDefaults();
    const out: Record<string, Param<unknown>> = {};
    for (const [k, v] of Object.entries(d)) out[k] = konst(v) as Param<unknown>;
    return out;
  },

  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[] {
    const p = read(resolved);
    if (!ctx.source) return [];
    const ramp = p.ramp.length ? p.ramp : ' .';
    // Quantise to a frame so the preview and every exported frame ask the source for
    // identical data. Inert for stills; how a video source is addressed.
    const frame = Math.round((ctx.time + ctx.srcTime) * (ctx.fps || 25));
    const { cols, rows } = gridForCell(p.cell, ctx.width, ctx.height);
    // One sample cell per character cell, cropped to the CANVAS shape — never to cols/rows.
    // Deriving the grid from a cell size keeps those two nearly equal, but only to within
    // the rounding to whole cells, and "nearly" is how the stretched-picture bug read: 80×45
    // is exactly 16:9, so it looked right on an HD canvas and squashed every other one.
    const grid = gridFor(cols, rows, ctx.width, ctx.height);
    const sample = sampleSource(ctx.source, grid, frame, ctx.fps || 25);
    if (!sample) return []; // still decoding — repaint fires when ready
    const font = fontStack(p.fontKey);
    const cells = buildCells(cols, rows, ctx.width, ctx.height, p.seed);
    const size = (p.glyphScale / 100) * (ctx.height / rows);
    const tone = { contrast: p.contrast, brightness: p.brightness, invert: p.invert };
    const out: Placement[] = [];
    for (const cell of cells) {
      if (cell.rFill * 100 >= p.density) continue;
      const idx = cell.r * sample.cols + cell.c;
      const ink = inkFromLum(sample.lum[idx], tone);
      if (!keepsInk(ink, p.cutLights, p.cutDarks)) continue;
      const glyph = rampChar(ink, ramp);
      if (glyph === ' ') continue;
      const color = p.useImgColors
        ? `rgb(${sample.rgb[idx * 3]},${sample.rgb[idx * 3 + 1]},${sample.rgb[idx * 3 + 2]})`
        : p.palette[Math.floor(cell.rColor * p.palette.length)] ?? '#000';
      out.push({ x: cell.cx, y: cell.cy, size, glyph, color, rotation: 0, alpha: 1, weight: p.weight, font });
    }
    return out;
  },
};
