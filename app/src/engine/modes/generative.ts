import { konst, type Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';
import { buildCells } from '../cells';
import { fontStack } from '../fonts';
import type { ModeContext, RenderMode } from './types';

export interface GenerativeParams {
  seed: number;
  glyphs: string[];
  fontKey: string;
  weight: string;
  cols: number;
  rows: number;
  density: number; // 1..100 (% of cells filled)
  size: number; // px
  sizeJit: number; // 0..100
  posJit: number; // 0..100
  rotJit: number; // degrees
  palette: string[];
}

function read(resolved: Record<string, unknown>): GenerativeParams {
  const d = generativeDefaults();
  const g = <T,>(k: keyof GenerativeParams, fallback: T): T =>
    (resolved[k as string] as T) ?? fallback;
  return {
    seed: g('seed', d.seed),
    glyphs: g('glyphs', d.glyphs),
    fontKey: g('fontKey', d.fontKey),
    weight: g('weight', d.weight),
    cols: g('cols', d.cols),
    rows: g('rows', d.rows),
    density: g('density', d.density),
    size: g('size', d.size),
    sizeJit: g('sizeJit', d.sizeJit),
    posJit: g('posJit', d.posJit),
    rotJit: g('rotJit', d.rotJit),
    palette: g('palette', d.palette),
  };
}

function generativeDefaults(): GenerativeParams {
  return {
    seed: 1,
    glyphs: ['/', '\\', '<', '>', '-'],
    fontKey: 'mono',
    weight: '400',
    cols: 24,
    rows: 14,
    density: 45,
    size: 42,
    sizeJit: 0,
    posJit: 0,
    rotJit: 0,
    palette: ['#2f43fa', '#0a0a0a'],
  };
}

export const generativeMode: RenderMode = {
  key: 'generative',
  label: 'Generative',

  defaultParams(): Record<string, Param<unknown>> {
    const d = generativeDefaults();
    const out: Record<string, Param<unknown>> = {};
    for (const [k, v] of Object.entries(d)) out[k] = konst(v) as Param<unknown>;
    return out;
  },

  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[] {
    const p = read(resolved);
    const font = fontStack(p.fontKey);
    const cells = buildCells(p.cols, p.rows, ctx.width, ctx.height, p.seed);
    const out: Placement[] = [];
    for (const cell of cells) {
      if (cell.rFill * 100 >= p.density) continue;
      const jx = cell.rPx * (p.posJit / 100) * cell.cw * 0.5;
      const jy = cell.rPy * (p.posJit / 100) * cell.ch * 0.5;
      const size = p.size * (1 + cell.rSize * (p.sizeJit / 100) - p.sizeJit / 200);
      const glyph = p.glyphs[Math.floor(cell.rGlyph * p.glyphs.length)] ?? '?';
      const color = p.palette[Math.floor(cell.rColor * p.palette.length)] ?? '#000';
      const rotation = cell.rRot * ((p.rotJit * Math.PI) / 180);
      out.push({
        x: cell.cx + jx,
        y: cell.cy + jy,
        size,
        glyph,
        color,
        rotation,
        alpha: 1,
        weight: p.weight,
        font,
      });
    }
    return out;
  },
};
