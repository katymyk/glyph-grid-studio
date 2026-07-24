import { parseGlyphs } from '../lib/glyphs';
import type { PanelDef } from '../ui/controls/types';

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
      { kind: 'slider', param: 'density', label: 'Cell fill', min: 1, max: 100, format: (v) => `${v}%` },
      { kind: 'slider', param: 'size', label: 'Symbol size', min: 6, max: 200, format: (v) => `${v}px` },
      { kind: 'slider', param: 'sizeJit', label: 'Size jitter', min: 0, max: 100, format: (v) => `${v}%` },
      { kind: 'slider', param: 'posJit', label: 'Position jitter', min: 0, max: 100, format: (v) => `${v}%` },
      { kind: 'slider', param: 'rotJit', label: 'Rotation', min: 0, max: 90, format: (v) => `${v}°` },
    ],
  },
];

const asciiPanels: PanelDef[] = [
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
      { kind: 'slider', param: 'density', label: 'Cell fill', min: 1, max: 100, format: (v) => `${v}%` },
      { kind: 'slider', param: 'size', label: 'Symbol size', min: 4, max: 80, format: (v) => `${v}px` },
    ],
  },
];

export function panelsForMode(mode: string): PanelDef[] {
  switch (mode) {
    case 'generative':
      return generativePanels;
    case 'ascii':
      return asciiPanels;
    default:
      return [];
  }
}
