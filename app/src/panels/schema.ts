import { parseGlyphs } from '../lib/glyphs';
import {
  effectiveCell,
  effectivePixelSize,
  siteCount,
  type Lattice,
} from '../engine/halftone/screen';
import { isVideoRef } from '../engine/videoSource';
import type { Control, PanelDef } from '../ui/controls/types';

/**
 * Clip controls, for the modes that read a source. The whole group hides itself for a
 * still image (a SchemaPanel with nothing visible renders nothing), so `srcTime` — which
 * is meaningless for a picture — only appears once there is a clip to move through.
 *
 * The range is fixed rather than the clip's length because a schema is static data; it
 * covers the common case of trimming into the first half-minute. Retiming beyond that is
 * what keyframing the param is for.
 */
const clipPanel: PanelDef = {
  id: 'clip',
  title: 'Clip',
  defaultOpen: true,
  controls: [
    {
      kind: 'slider',
      param: 'srcTime',
      label: 'Source time (offset into clip)',
      min: 0,
      max: 30,
      step: 0.05,
      when: (p) => isVideoRef(p.image),
      format: (v) => `${v.toFixed(2)}s`,
    } satisfies Control,
  ],
};

/**
 * Sidebar described as data. Reorder / relabel / regroup by editing these arrays;
 * add a control by adding an entry. Each mode contributes its own panel set.
 */
const generativePanels: PanelDef[] = [
  {
    id: 'content',
    title: 'Content',
    defaultOpen: true,
    controls: [
      {
        kind: 'text',
        param: 'glyphs',
        label: 'Symbols / text (space or line separated)',
        serialize: (v) => (Array.isArray(v) ? v.join(' ') : ''),
        parse: (s) => parseGlyphs(s),
      },
      {
        kind: 'chips',
        param: 'glyphs',
        label: 'Quick sets',
        presets: [
          { label: 'strokes', value: parseGlyphs('/ \\ < > -') },
          { label: 'dots', value: parseGlyphs('• ◦ ● ○') },
          { label: 'binary', value: parseGlyphs('0 1') },
          { label: 'arrows', value: parseGlyphs('↑ ↗ → ↘ ↓ ↙ ← ↖') },
          { label: 'math', value: parseGlyphs('+ × ÷ = ≈ ∞') },
        ],
      },
      {
        kind: 'segmented',
        param: 'weight',
        label: 'Weight',
        options: [
          { value: '300', label: 'Light' },
          { value: '400', label: 'Regular' },
          { value: '700', label: 'Bold' },
        ],
      },
    ],
  },
  {
    id: 'grid',
    title: 'Grid',
    defaultOpen: true,
    controls: [
      { kind: 'slider', param: 'cols', label: 'Columns', min: 4, max: 240 },
      { kind: 'slider', param: 'rows', label: 'Rows', min: 3, max: 140 },
      { kind: 'slider', param: 'density', label: 'Cell fill', min: 1, max: 100, format: (v) => `${Math.round(v)}%` },
      { kind: 'slider', param: 'size', label: 'Symbol size', min: 6, max: 200, format: (v) => `${Math.round(v)}px` },
      { kind: 'slider', param: 'sizeJit', label: 'Size jitter', min: 0, max: 100, format: (v) => `${Math.round(v)}%` },
      { kind: 'slider', param: 'posJit', label: 'Position jitter', min: 0, max: 100, format: (v) => `${Math.round(v)}%` },
      { kind: 'slider', param: 'rotJit', label: 'Rotation', min: 0, max: 90, format: (v) => `${Math.round(v)}°` },
    ],
  },
];

const asciiPanels: PanelDef[] = [
  clipPanel,
  {
    id: 'ascii',
    title: 'ASCII',
    defaultOpen: true,
    controls: [
      { kind: 'text', param: 'ramp', label: 'Character ramp (light → dark)' },
      {
        kind: 'chips',
        param: 'ramp',
        label: 'Ramp presets',
        presets: [
          { label: 'classic', value: ' .:-=+*#%@' },
          { label: 'blocks', value: ' .oO0@' },
          { label: 'shades', value: ' ░▒▓█' },
          { label: 'detailed', value: ' .,:;irsXA253hMHGS#9B&@' },
          { label: 'dots', value: ' .·•●' },
        ],
      },
      { kind: 'toggle', param: 'invert', label: 'Invert brightness' },
      { kind: 'toggle', param: 'useImgColors', label: 'Use image colors' },
      { kind: 'slider', param: 'contrast', label: 'Contrast', min: 20, max: 300, format: (v) => `${(v / 100).toFixed(2)}×` },
      { kind: 'slider', param: 'brightness', label: 'Brightness', min: -100, max: 100 },
    ],
  },
  {
    id: 'grid',
    title: 'Grid',
    defaultOpen: true,
    controls: [
      { kind: 'slider', param: 'cols', label: 'Columns', min: 8, max: 400 },
      { kind: 'slider', param: 'rows', label: 'Rows', min: 6, max: 300 },
      { kind: 'slider', param: 'density', label: 'Cell fill', min: 1, max: 100, format: (v) => `${Math.round(v)}%` },
      { kind: 'slider', param: 'size', label: 'Symbol size', min: 4, max: 80, format: (v) => `${Math.round(v)}px` },
    ],
  },
];

// ---------------------------------------------------------------- halftone

/** The dot screen is one method among several; these predicates keep each method's
    controls out of the way when another is selected. */
const isDots = (p: Record<string, unknown>) => p.algo === 'halftone';
const isDither = (p: Record<string, unknown>) => p.algo !== 'halftone';
const isDiffusion = (p: Record<string, unknown>) => p.algo === 'floyd' || p.algo === 'atkinson';
const isNoise = (p: Record<string, unknown>) => p.algo === 'noise';

const num = (v: unknown, f: number) => (typeof v === 'number' ? v : f);

/**
 * Disclose the element cap. Both the screen pitch and the dither cell get raised when
 * the requested value would blow past `maxElements`, and a cap you cannot see reads as
 * a bug — so this shows the effective value and the real element count, computed by the
 * same functions the renderer uses.
 */
function capReadout(p: Record<string, unknown>, scene: { width: number; height: number }): string {
  const { width: W, height: H } = scene;
  const max = num(p.maxElements, 40000);
  const lattice = (p.lattice as Lattice) ?? 'square';
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  if (isDots(p)) {
    const want = Math.max(1, num(p.cell, 8));
    const got = effectiveCell(W, H, want, lattice, max);
    // siteCount, not a local formula — the readout must agree with what renders.
    // "up to", because the grid is the ceiling: dots below the size floor, and dots
    // over transparent source, are culled. The Export panel shows the real drawn count.
    const dots = siteCount(W, H, got, lattice);
    return got > want + 1e-6
      ? `${want.toFixed(0)} → ${got.toFixed(1)}px · up to ${n(dots)} dots (capped)`
      : `${got.toFixed(1)}px · up to ${n(dots)} dots`;
  }
  const want = Math.max(1, num(p.pixel, 4));
  const got = effectivePixelSize(W, H, want, max);
  const cells = (W * H) / (got * got);
  return got > want + 1e-6
    ? `${want.toFixed(0)} → ${got.toFixed(1)}px · ${n(cells)} cells (capped)`
    : `${got.toFixed(1)}px · ${n(cells)} cells before merging`;
}

const halftonePanels: PanelDef[] = [
  clipPanel,
  {
    id: 'method',
    title: 'Method',
    defaultOpen: true,
    controls: [
      {
        kind: 'select',
        param: 'algo',
        label: 'Algorithm',
        options: [
          { value: 'halftone', label: 'Halftone — dot screen' },
          { value: 'floyd', label: 'Floyd–Steinberg' },
          { value: 'atkinson', label: 'Atkinson' },
          { value: 'bayer4', label: 'Ordered 4×4' },
          { value: 'bayer8', label: 'Ordered 8×8' },
          { value: 'noise', label: 'Random noise' },
        ],
      },
    ],
  },
  {
    id: 'screen',
    title: 'Dot screen',
    defaultOpen: true,
    controls: [
      {
        kind: 'slider',
        param: 'cell',
        label: 'Cell size (screen pitch)',
        min: 3,
        max: 64,
        when: isDots,
        format: (v) => `${Math.round(v)}px`,
      },
      {
        kind: 'slider',
        param: 'angle',
        label: 'Screen angle',
        min: 0,
        max: 90,
        when: isDots,
        format: (v) => `${Math.round(v)}°`,
      },
      {
        kind: 'segmented',
        param: 'lattice',
        label: 'Grid',
        when: isDots,
        options: [
          { value: 'square', label: 'Square' },
          { value: 'hex', label: 'Hex' },
        ],
      },
      {
        kind: 'select',
        param: 'dotShape',
        label: 'Dot shape',
        when: isDots,
        options: [
          { value: 'dot', label: 'Circle' },
          { value: 'square', label: 'Square' },
          { value: 'diamond', label: 'Diamond' },
          { value: 'ring', label: 'Ring' },
          { value: 'cross', label: 'Cross' },
          { value: 'line', label: 'Bar' },
        ],
      },
      {
        kind: 'slider',
        param: 'thickness',
        label: 'Stroke weight',
        min: 5,
        max: 90,
        // Only the shapes whose thickness is distinct from their extent.
        when: (p) =>
          isDots(p) && (p.dotShape === 'ring' || p.dotShape === 'cross' || p.dotShape === 'line'),
        format: (v) => `${Math.round(v)}%`,
      },
      {
        kind: 'slider',
        param: 'jitter',
        label: 'Jitter',
        min: 0,
        max: 100,
        when: isDots,
        format: (v) => `${Math.round(v)}%`,
      },
    ],
  },
  {
    id: 'dots',
    title: 'Dot size & fill',
    defaultOpen: true,
    controls: [
      {
        kind: 'slider',
        param: 'dotScale',
        label: 'Dot size',
        min: 20,
        max: 200,
        when: isDots,
        format: (v) => `${Math.round(v)}%`,
      },
      {
        kind: 'slider',
        param: 'fill',
        label: 'Ink / fill amount',
        min: 20,
        max: 200,
        when: isDots,
        format: (v) => `${Math.round(v)}%`,
      },
      {
        kind: 'segmented',
        param: 'sizeMap',
        label: 'Tone response',
        when: isDots,
        options: [
          { value: 'area', label: 'Classic' },
          { value: 'coverage', label: 'Accurate' },
          { value: 'linear', label: 'Light' },
        ],
      },
      {
        kind: 'slider',
        param: 'minDot',
        label: 'Smallest dot',
        min: 0,
        max: 3,
        step: 0.05,
        when: isDots,
        format: (v) => (v <= 0 ? 'keep all' : `${v.toFixed(2)}px`),
      },
      {
        kind: 'slider',
        param: 'pixel',
        label: 'Pixel size',
        min: 2,
        max: 24,
        when: isDither,
        format: (v) => `${Math.round(v)}px`,
      },
      {
        kind: 'toggle',
        param: 'serpentine',
        label: 'Serpentine scan (fewer worms)',
        when: isDiffusion,
      },
      {
        kind: 'slider',
        param: 'grain',
        label: 'Grain spread',
        min: 50,
        max: 200,
        when: isNoise,
        format: (v) => `${Math.round(v)}%`,
      },
    ],
  },
  {
    id: 'tone',
    title: 'Image tone',
    defaultOpen: true,
    controls: [
      {
        kind: 'slider',
        param: 'brightness',
        label: 'Brightness',
        min: -100,
        max: 100,
      },
      {
        kind: 'slider',
        param: 'contrast',
        label: 'Contrast',
        min: 20,
        max: 300,
        format: (v) => `${(v / 100).toFixed(2)}×`,
      },
      {
        kind: 'slider',
        param: 'gamma',
        label: 'Gamma',
        min: 20,
        max: 300,
        format: (v) => (Math.round(v) === 100 ? 'off' : `${(v / 100).toFixed(2)}`),
      },
      {
        kind: 'slider',
        param: 'threshold',
        label: 'Threshold',
        min: -100,
        max: 100,
      },
      { kind: 'toggle', param: 'invert', label: 'Invert' },
    ],
  },
  {
    id: 'ink',
    title: 'Ink & limits',
    // Open by default: this group holds the element-cap disclosure, and a cap the user
    // has to go looking for is not meaningfully disclosed.
    defaultOpen: true,
    controls: [
      {
        kind: 'toggle',
        param: 'useImgColors',
        label: 'Use image colors',
        when: isDots,
      },
      {
        kind: 'slider',
        param: 'maxElements',
        label: 'Element cap',
        min: 5000,
        max: 400000,
        step: 5000,
        format: (v) => `${Math.round(v / 1000)}k`,
      },
      { kind: 'readout', param: 'cell', label: 'Actual', compute: capReadout },
    ],
  },
];

export function panelsForMode(mode: string): PanelDef[] {
  switch (mode) {
    case 'generative':
      return generativePanels;
    case 'ascii':
      return asciiPanels;
    case 'halftone':
      return halftonePanels;
    default:
      return [];
  }
}
