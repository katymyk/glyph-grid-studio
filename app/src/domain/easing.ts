/**
 * Easing, modelled the way motion tools model it: a keyframe owns two *half*
 * curves — how the value LEAVES it (`easeOut`) and how the value ARRIVES at it
 * (`easeIn`) — and the curve of the segment between two keyframes is composed
 * from the left key's `easeOut` and the right key's `easeIn`.
 *
 * That is why there is no single "easing" value anywhere: "ease in / ease out"
 * belongs to a keyframe, and the resulting curve belongs to the span between
 * two keyframes. `segmentProgress` is the one function that resolves a span.
 */

/** A half curve — the shape of one end of a segment. 'linear' means "no easing". */
export type EaseHalf =
  | 'linear'
  | 'sine'
  | 'quad'
  | 'cubic'
  | 'quart'
  | 'expo'
  | 'circ'
  | 'back'
  | 'elastic'
  | 'bounce';

/** Pickable curves, ordered gentle → wild. Used by the easing dropdowns. */
export const EASE_OPTIONS: { value: EaseHalf; label: string }[] = [
  { value: 'linear', label: 'None · linear' },
  { value: 'sine', label: 'Sine · gentlest' },
  { value: 'quad', label: 'Quad · soft' },
  { value: 'cubic', label: 'Cubic · standard' },
  { value: 'quart', label: 'Quart · strong' },
  { value: 'expo', label: 'Expo · sharpest' },
  { value: 'circ', label: 'Circ · snappy' },
  { value: 'back', label: 'Back · overshoots' },
  { value: 'elastic', label: 'Elastic · springy' },
  { value: 'bounce', label: 'Bounce' },
];

const LABELS: Record<EaseHalf, string> = {
  linear: 'linear',
  sine: 'sine',
  quad: 'quad',
  cubic: 'cubic',
  quart: 'quart',
  expo: 'expo',
  circ: 'circ',
  back: 'back',
  elastic: 'elastic',
  bounce: 'bounce',
};

export function easeLabel(f: EaseHalf): string {
  return LABELS[f] ?? f;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const C1 = 1.70158; // back overshoot
const C3 = C1 + 1;
const C4 = (2 * Math.PI) / 3; // elastic period

function bounceOut(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

/**
 * The slow-start half: what a value does as it LEAVES an eased keyframe.
 * (Called "ease out" on a keyframe, "ease in" as a curve — the classic
 * naming collision. Keyframe wording wins in the UI, curve wording here.)
 */
export function easeInCurve(f: EaseHalf, xIn: number): number {
  const x = clamp01(xIn);
  switch (f) {
    case 'sine':
      return 1 - Math.cos((x * Math.PI) / 2);
    case 'quad':
      return x * x;
    case 'cubic':
      return x * x * x;
    case 'quart':
      return x * x * x * x;
    case 'expo':
      return x === 0 ? 0 : Math.pow(2, 10 * x - 10);
    case 'circ':
      return 1 - Math.sqrt(1 - x * x);
    case 'back':
      return C3 * x * x * x - C1 * x * x;
    case 'elastic':
      return x === 0 || x === 1
        ? x
        : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * C4);
    case 'bounce':
      return 1 - bounceOut(1 - x);
    case 'linear':
    default:
      return x;
  }
}

/** The slow-end half: what a value does as it ARRIVES at an eased keyframe. */
export function easeOutCurve(f: EaseHalf, xIn: number): number {
  return 1 - easeInCurve(f, 1 - clamp01(xIn));
}

/**
 * Resolve one segment: `fromOut` is the left keyframe's departure curve,
 * `toIn` is the right keyframe's arrival curve. Either end can be 'linear'
 * (no easing), which is how you get a plain slow-in or slow-out.
 *
 * When both ends ease, each owns half the span — so "expo out of A into a
 * bounce arrival at B" is a curve you can actually build.
 *
 * The result can leave 0..1 on purpose (back/elastic overshoot).
 */
export function segmentProgress(fromOut: EaseHalf, toIn: EaseHalf, u: number): number {
  const x = clamp01(u);
  const easesOut = fromOut !== 'linear';
  const easesIn = toIn !== 'linear';
  if (!easesOut && !easesIn) return x;
  if (easesOut && !easesIn) return easeInCurve(fromOut, x);
  if (!easesOut && easesIn) return easeOutCurve(toIn, x);
  return x < 0.5
    ? easeInCurve(fromOut, x * 2) / 2
    : 0.5 + easeOutCurve(toIn, x * 2 - 1) / 2;
}

/** Sample a segment curve for drawing a preview. Returns n+1 points, y unclamped. */
export function sampleCurve(
  fromOut: EaseHalf,
  toIn: EaseHalf,
  n = 48,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    pts.push({ x, y: segmentProgress(fromOut, toIn, x) });
  }
  return pts;
}

/** Named segment shapes — one click instead of two dropdowns. */
export interface EasePreset {
  key: string;
  label: string;
  out: EaseHalf; // applied to the left keyframe's easeOut
  in: EaseHalf; // applied to the right keyframe's easeIn
}

export const SEGMENT_PRESETS: EasePreset[] = [
  { key: 'linear', label: 'Linear', out: 'linear', in: 'linear' },
  { key: 'slow-start', label: 'Slow start', out: 'cubic', in: 'linear' },
  { key: 'slow-end', label: 'Slow end', out: 'linear', in: 'cubic' },
  { key: 'smooth', label: 'Smooth', out: 'cubic', in: 'cubic' },
  { key: 'gentle', label: 'Gentle', out: 'sine', in: 'sine' },
  { key: 'snappy', label: 'Snappy', out: 'expo', in: 'expo' },
  { key: 'overshoot', label: 'Overshoot', out: 'cubic', in: 'back' },
  { key: 'spring', label: 'Spring', out: 'cubic', in: 'elastic' },
  { key: 'bounce', label: 'Bounce', out: 'cubic', in: 'bounce' },
];
