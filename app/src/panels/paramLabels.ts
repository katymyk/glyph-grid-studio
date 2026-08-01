import { panelsForMode } from './schema';

/** Extra labels for params that have no sidebar control of their own. */
const EXTRA: Record<string, string> = {
  opacity: 'Layer opacity',
  seed: 'Seed',
  palette: 'Palette',
  image: 'Image',
  fontKey: 'Font',
  glyphs: 'Symbols',
  ramp: 'Character ramp',
  // Halftone params with no control of their own (or whose control is a readout).
  srcTime: 'Source time',
  maxElements: 'Element cap',
};

const cache = new Map<string, Record<string, string>>();

function labelsFor(mode: string): Record<string, string> {
  let m = cache.get(mode);
  if (!m) {
    m = {};
    for (const panel of panelsForMode(mode)) {
      for (const c of panel.controls) {
        // Readouts describe a param without naming it ("Actual"), so they'd give a
        // useless timeline label for whatever param they happen to reference.
        if (c.kind === 'readout') continue;
        // strip parenthetical hints — the timeline gutter is narrow
        if (!m[c.param]) m[c.param] = c.label.split('(')[0].trim();
      }
    }
    cache.set(mode, m);
  }
  return m;
}

/** Human label for a param, reusing the sidebar schema so the two never disagree. */
export function paramLabel(mode: string, key: string): string {
  return labelsFor(mode)[key] ?? EXTRA[key] ?? key;
}
