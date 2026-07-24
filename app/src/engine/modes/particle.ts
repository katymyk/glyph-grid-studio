import { konst, type Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';
import { fontStack } from '../fonts';
import { makeRNG } from '../rng';
import type { ModeContext, RenderMode } from './types';

export interface ParticleParams {
  count: number;
  size: number;
  sizeJit: number; // 0..100
  speed: number; // px/sec scale
  motion: string; // 'drift' | 'fall' | 'swirl'
  twinkle: number; // 0..100 alpha flicker
  glyphs: string[];
  palette: string[];
  seed: number;
  fontKey: string;
  weight: string;
}

function particleDefaults(): ParticleParams {
  return {
    count: 300,
    size: 24,
    sizeJit: 30,
    speed: 40,
    motion: 'drift',
    twinkle: 0,
    glyphs: ['•', '◦', '+', '·'],
    palette: ['#2f43fa', '#0a0a0a'],
    seed: 1,
    fontKey: 'mono',
    weight: '400',
  };
}

function read(r: Record<string, unknown>): ParticleParams {
  const d = particleDefaults();
  const g = <T,>(k: keyof ParticleParams, f: T): T => (r[k as string] as T) ?? f;
  return {
    count: g('count', d.count),
    size: g('size', d.size),
    sizeJit: g('sizeJit', d.sizeJit),
    speed: g('speed', d.speed),
    motion: g('motion', d.motion),
    twinkle: g('twinkle', d.twinkle),
    glyphs: g('glyphs', d.glyphs),
    palette: g('palette', d.palette),
    seed: g('seed', d.seed),
    fontKey: g('fontKey', d.fontKey),
    weight: g('weight', d.weight),
  };
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

export const particleMode: RenderMode = {
  key: 'particle',
  label: 'Particles',

  defaultParams(): Record<string, Param<unknown>> {
    const d = particleDefaults();
    const out: Record<string, Param<unknown>> = {};
    for (const [k, v] of Object.entries(d)) out[k] = konst(v) as Param<unknown>;
    return out;
  },

  // Deterministic (seed) particle field, positioned as a function of time t.
  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[] {
    const p = read(resolved);
    const { width: W, height: H, time: t } = ctx;
    const rng = makeRNG(p.seed);
    const font = fontStack(p.fontKey);
    const tw = p.twinkle / 100;
    const n = Math.max(0, Math.min(5000, Math.round(p.count)));
    const out: Placement[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = rng() * W;
      const y0 = rng() * H;
      const angle = rng() * Math.PI * 2;
      const sp = (0.5 + rng()) * p.speed;
      const phase = rng();
      const gi = Math.floor(rng() * p.glyphs.length);
      const ci = Math.floor(rng() * p.palette.length);
      const sf = 1 + (rng() * 2 - 1) * (p.sizeJit / 100);

      let x: number, y: number;
      if (p.motion === 'fall') {
        y = mod(y0 + sp * t, H);
        x = mod(x0 + Math.sin(t * 0.7 + phase * 6.28) * sp * 0.3, W);
      } else if (p.motion === 'swirl') {
        const r = 50 + phase * Math.min(W, H) * 0.45;
        const a = angle + (sp / (r + 60)) * t;
        x = W / 2 + Math.cos(a) * r;
        y = H / 2 + Math.sin(a) * r;
      } else {
        x = mod(x0 + Math.cos(angle) * sp * t, W);
        y = mod(y0 + Math.sin(angle) * sp * t, H);
      }

      const alpha = tw > 0 ? 1 - tw + tw * (0.5 + 0.5 * Math.sin(t * 2 + phase * 6.28)) : 1;
      if (alpha <= 0.02) continue;
      out.push({
        x,
        y,
        size: p.size * sf,
        glyph: p.glyphs[gi] ?? '?',
        color: p.palette[ci] ?? '#000',
        rotation: 0,
        alpha,
        weight: p.weight,
        font,
      });
    }
    return out;
  },
};
