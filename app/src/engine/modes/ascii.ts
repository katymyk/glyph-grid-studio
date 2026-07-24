import { konst, type Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';
import { buildCells } from '../cells';
import { fontStack } from '../fonts';
import { getSample } from '../imageSample';
import type { ModeContext, RenderMode } from './types';

export interface AsciiParams {
  image: string | null; // data URL
  ramp: string;
  invert: boolean;
  useImgColors: boolean;
  contrast: number; // 20..300 (%)
  brightness: number; // -100..100
  cols: number;
  rows: number;
  density: number;
  size: number;
  seed: number;
  fontKey: string;
  weight: string;
  palette: string[];
}

function asciiDefaults(): AsciiParams {
  return {
    image: null,
    ramp: ' .:-=+*#%@',
    invert: false,
    useImgColors: false,
    contrast: 100,
    brightness: 0,
    cols: 80,
    rows: 45,
    density: 100,
    size: 16,
    seed: 1,
    fontKey: 'mono',
    weight: '400',
    palette: ['#2f43fa', '#0a0a0a'],
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Luminance → ramp glyph, with contrast/brightness/invert applied at draw time. */
function rampChar(b: number, ramp: string, invert: boolean, contrast: number, brightness: number): string {
  const v = clamp01((b - 0.5) * (contrast / 100) + 0.5 + brightness / 100);
  const t = invert ? v : 1 - v;
  let ri = Math.round(t * (ramp.length - 1));
  ri = ri < 0 ? 0 : ri > ramp.length - 1 ? ramp.length - 1 : ri;
  return ramp[ri];
}

function read(r: Record<string, unknown>): AsciiParams {
  const d = asciiDefaults();
  const g = <T,>(k: keyof AsciiParams, f: T): T => (r[k as string] as T) ?? f;
  return {
    image: g('image', d.image),
    ramp: g('ramp', d.ramp),
    invert: g('invert', d.invert),
    useImgColors: g('useImgColors', d.useImgColors),
    contrast: g('contrast', d.contrast),
    brightness: g('brightness', d.brightness),
    cols: g('cols', d.cols),
    rows: g('rows', d.rows),
    density: g('density', d.density),
    size: g('size', d.size),
    seed: g('seed', d.seed),
    fontKey: g('fontKey', d.fontKey),
    weight: g('weight', d.weight),
    palette: g('palette', d.palette),
  };
}

export const asciiMode: RenderMode = {
  key: 'ascii',
  label: 'ASCII',

  defaultParams(): Record<string, Param<unknown>> {
    const d = asciiDefaults();
    const out: Record<string, Param<unknown>> = {};
    for (const [k, v] of Object.entries(d)) out[k] = konst(v) as Param<unknown>;
    return out;
  },

  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[] {
    const p = read(resolved);
    if (!p.image) return [];
    const ramp = p.ramp.length ? p.ramp : ' .';
    const sample = getSample(p.image, p.cols, p.rows);
    if (!sample) return []; // still decoding — repaint fires when ready
    const font = fontStack(p.fontKey);
    const cells = buildCells(p.cols, p.rows, ctx.width, ctx.height, p.seed);
    const out: Placement[] = [];
    for (const cell of cells) {
      if (cell.rFill * 100 >= p.density) continue;
      const idx = cell.r * sample.cols + cell.c;
      const glyph = rampChar(sample.lum[idx], ramp, p.invert, p.contrast, p.brightness);
      if (glyph === ' ') continue;
      const color = p.useImgColors
        ? `rgb(${sample.rgb[idx * 3]},${sample.rgb[idx * 3 + 1]},${sample.rgb[idx * 3 + 2]})`
        : p.palette[Math.floor(cell.rColor * p.palette.length)] ?? '#000';
      out.push({ x: cell.cx, y: cell.cy, size: p.size, glyph, color, rotation: 0, alpha: 1, weight: p.weight, font });
    }
    return out;
  },
};
