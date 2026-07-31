import { konst, type Param } from '../../domain/params';
import type { Placement, ShapeKind } from '../../domain/scene';
import { buildDots } from '../halftone/dots';
import { workingHeight, workingWidth } from '../halftone/field';
import { buildDither } from '../halftone/runs';
import { effectiveCell, effectivePixelSize, type Lattice } from '../halftone/screen';
import type { SizeMap } from '../halftone/sizeMap';
import type { DitherAlgo } from '../halftone/dither';
import { sampleSource } from '../imageSample';
import { inkThreshold, type ToneOpts } from '../tone';
import type { ModeContext, RenderMode } from './types';

/**
 * Halftone mode — screening an image into marks.
 *
 * `algo` picks the method. `'halftone'` is the rotatable dot screen (the point of the
 * mode); the other five are threshold methods that produce a 1-bit image, emitted as
 * run-merged pixel boxes. All of them share one tone stage and one element cap.
 *
 * This file owns only the browser-side part — sampling the source and dispatching.
 * The geometry, tone and dithering all live in `engine/halftone/*`, DOM-free, so they
 * can be exercised without a browser.
 *
 * Two rules it obeys, both load-bearing:
 *  - it NEVER paints a background. Background is a Scene property and `null` means
 *    transparent, so `invert` flips which cells get ink, never the paper colour.
 *  - it only ever emits ink. Nothing is drawn for the light cells.
 *
 * Import note: this file must not value-import from `./index`. The registry imports
 * the modes, so a cycle back would run `registerMode(halftoneMode)` before this
 * module body finished and register `undefined`.
 */

/** The dot screen, plus the five threshold algorithms. */
export type HalftoneAlgo = 'halftone' | DitherAlgo;

export interface HalftoneParams {
  image: string | null; // data URL
  /** Source time offset in seconds. Inert for a still image — it exists so a video
      source (next iteration) is retimeable on the existing keyframe timeline without
      any new machinery: keyframe this and you have scrubbed the clip. */
  srcTime: number;
  algo: HalftoneAlgo;

  // dot screen
  cell: number; // px — the screen pitch ("grid size")
  angle: number; // degrees — screen angle
  lattice: Lattice;
  dotShape: ShapeKind;
  dotScale: number; // % — dot size at full darkness, relative to the cell
  sizeMap: SizeMap;
  fill: number; // % — ink gain: scales darkness, so more cells fill further
  minDot: number; // px — cull dots smaller than this
  jitter: number; // % of half a cell — organic, deterministic displacement
  thickness: number; // % — stroke/arm width for the ring, cross and bar shapes

  // threshold algorithms
  pixel: number; // px — dither cell size
  grain: number; // % — noise band width
  serpentine: boolean;

  // tone
  contrast: number; // 20..300 (%)
  brightness: number; // -100..100
  gamma: number; // 20..300 (%)
  threshold: number; // -100..100
  invert: boolean;

  // ink
  useImgColors: boolean;
  palette: string[];

  maxElements: number;
  seed: number;
}

function halftoneDefaults(): HalftoneParams {
  return {
    image: null,
    srcTime: 0,
    algo: 'halftone',
    cell: 8,
    angle: 45,
    lattice: 'square',
    dotShape: 'dot',
    dotScale: 100,
    sizeMap: 'area',
    fill: 100,
    minDot: 0.35,
    jitter: 0,
    thickness: 35,
    pixel: 4,
    grain: 100,
    serpentine: false,
    contrast: 100,
    brightness: 0,
    gamma: 100,
    threshold: 0,
    invert: false,
    useImgColors: false,
    palette: ['#0a0a0a'],
    // Sized so the DEFAULT cell/pixel values run uncapped on a 1920×1080 and a 4K
    // canvas — a cap that fires at the defaults would mean the mode silently ignores
    // its own starting settings. Going finer than the default does get capped, and
    // the sidebar says so.
    maxElements: 150000,
    seed: 1,
  };
}

function read(r: Record<string, unknown>): HalftoneParams {
  const d = halftoneDefaults();
  const g = <T,>(k: keyof HalftoneParams, f: T): T => (r[k as string] as T) ?? f;
  return {
    image: g('image', d.image),
    srcTime: g('srcTime', d.srcTime),
    algo: g('algo', d.algo),
    cell: g('cell', d.cell),
    angle: g('angle', d.angle),
    lattice: g('lattice', d.lattice),
    dotShape: g('dotShape', d.dotShape),
    dotScale: g('dotScale', d.dotScale),
    sizeMap: g('sizeMap', d.sizeMap),
    fill: g('fill', d.fill),
    minDot: g('minDot', d.minDot),
    jitter: g('jitter', d.jitter),
    thickness: g('thickness', d.thickness),
    pixel: g('pixel', d.pixel),
    grain: g('grain', d.grain),
    serpentine: g('serpentine', d.serpentine),
    contrast: g('contrast', d.contrast),
    brightness: g('brightness', d.brightness),
    gamma: g('gamma', d.gamma),
    threshold: g('threshold', d.threshold),
    invert: g('invert', d.invert),
    useImgColors: g('useImgColors', d.useImgColors),
    palette: g('palette', d.palette),
    maxElements: g('maxElements', d.maxElements),
    seed: g('seed', d.seed),
  };
}

/**
 * Full tone for the dot screen: threshold acts as a smooth offset (it slides every
 * dot size at once) and invert flips which luminances get the big dots.
 */
function toneOf(p: HalftoneParams): ToneOpts {
  return {
    contrast: p.contrast,
    brightness: p.brightness,
    gamma: p.gamma,
    threshold: p.threshold,
    invert: p.invert,
  };
}

/**
 * Tone for the threshold algorithms: SHAPING ONLY.
 *
 * There, `threshold` becomes the binary cut and `invert` becomes a polarity flip on
 * the finished bitmap, so neither belongs in the shaping stage — including them would
 * apply each twice, which doubles the threshold under error diffusion and cancels it
 * outright under an ordered matrix.
 */
function shapeToneOf(p: HalftoneParams): ToneOpts {
  return { contrast: p.contrast, brightness: p.brightness, gamma: p.gamma };
}

/** Ink colour: the first palette entry. Colour is a layer concern (the Colors panel),
    never a hardcoded black/white the way a fixed-polarity tool does it. */
function inkColor(p: HalftoneParams): string {
  return p.palette[0] ?? '#000';
}

export const halftoneMode: RenderMode = {
  key: 'halftone',
  label: 'Halftone',

  defaultParams(): Record<string, Param<unknown>> {
    const d = halftoneDefaults();
    const out: Record<string, Param<unknown>> = {};
    for (const [k, v] of Object.entries(d)) out[k] = konst(v) as Param<unknown>;
    return out;
  },

  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[] {
    const p = read(resolved);
    if (!p.image) return [];
    const { width: W, height: H } = ctx;
    // Quantise to a frame so the preview and every exported frame ask the source for
    // byte-identical data. Inert for stills; the hook a video source needs.
    const frame = Math.round((ctx.time + p.srcTime) * (ctx.fps || 25));

    if (p.algo === 'halftone') {
      // One working grid per (image, canvas size): `cell` and `angle` are the params
      // people animate, and the sample cache is keyed by grid size, so a resolution
      // that tracked `cell` would re-downscale the source on most frames of a keyframe.
      const field = sampleSource(p.image, workingWidth(W), workingHeight(W, H), frame);
      if (!field) return []; // still decoding — a repaint fires when it lands
      return buildDots(field, W, H, {
        cell: effectiveCell(W, H, Math.max(1, p.cell), p.lattice, p.maxElements),
        angle: p.angle,
        lattice: p.lattice,
        shape: p.dotShape,
        scale: p.dotScale / 100,
        sizeMap: p.sizeMap,
        gain: p.fill / 100,
        minDot: p.minDot,
        jitter: p.jitter / 100,
        thickness: p.thickness / 100,
        tone: toneOf(p),
        color: inkColor(p),
        useImgColors: p.useImgColors,
        seed: p.seed,
      });
    }

    // For the threshold algorithms the dither grid IS the sample grid: downscaling to
    // cols×rows already area-averages, so there is no separate block-average pass.
    const px = effectivePixelSize(W, H, Math.max(1, p.pixel), p.maxElements);
    const field = sampleSource(
      p.image,
      Math.max(2, Math.round(W / px)),
      Math.max(2, Math.round(H / px)),
      frame,
    );
    if (!field) return [];
    return buildDither(
      field,
      W,
      H,
      p.algo,
      {
        tone: shapeToneOf(p),
        cut: inkThreshold({ threshold: p.threshold }),
        seed: p.seed,
        frame,
        grain: p.grain / 100,
        serpentine: p.serpentine,
      },
      p.invert,
      inkColor(p),
    );
  },
};
