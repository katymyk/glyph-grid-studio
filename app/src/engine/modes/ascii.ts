import { konst, type Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';
import { buildCells } from '../cells';
import { fontStack } from '../fonts';
import { sampleSource } from '../imageSample';
import { inkFromLum } from '../tone';
import type { ModeContext, RenderMode } from './types';

export interface AsciiParams {
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

/** Luminance → ramp glyph. Tone lives in engine/tone.ts, shared with halftone mode,
    so the same picture reads the same in both (and in a morph between them). */
function rampChar(b: number, ramp: string, invert: boolean, contrast: number, brightness: number): string {
  const t = inkFromLum(b, { contrast, brightness, invert });
  let ri = Math.round(t * (ramp.length - 1));
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
    const sample = sampleSource(ctx.source, p.cols, p.rows, frame, ctx.fps || 25);
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
