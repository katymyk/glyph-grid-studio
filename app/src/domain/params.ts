import { segmentProgress, type EaseHalf } from './easing';

/** The curve new keyframes get: a standard smooth ease on both ends. */
export const DEFAULT_EASE: EaseHalf = 'cubic';

export interface Keyframe<T> {
  t: number; // seconds
  value: T;
  /** How the value LEAVES this keyframe (start of the segment to its right). */
  easeOut: EaseHalf;
  /** How the value ARRIVES at this keyframe (end of the segment to its left). */
  easeIn: EaseHalf;
  /** Hold (step): freeze this value until the next keyframe, no interpolation. */
  hold?: boolean;
}

/**
 * A parameter is either a constant or a set of keyframes resolved at time t.
 * This is the unit that makes "start frame -> end frame" (and full timelines)
 * possible for any control in the app.
 */
export type Param<T> =
  | { kind: 'const'; value: T }
  | { kind: 'keys'; keys: Keyframe<T>[] };

/** Constant-param constructor. */
export function konst<T>(value: T): Param<T> {
  return { kind: 'const', value };
}

/** A keyframe with the default easing on both ends. */
export function makeKey<T>(t: number, value: T, easing: EaseHalf = DEFAULT_EASE): Keyframe<T> {
  return { t, value, easeOut: easing, easeIn: easing };
}

/** Two-keyframe animated param (the common "start -> end" case). */
export function ramp<T>(from: T, to: T, duration: number, easing: EaseHalf = DEFAULT_EASE): Param<T> {
  return { kind: 'keys', keys: [makeKey(0, from, easing), makeKey(duration, to, easing)] };
}

/** Make an animated param seeded with one keyframe at time t. */
export function keyframed<T>(value: T, t: number, easing: EaseHalf = DEFAULT_EASE): Param<T> {
  return { kind: 'keys', keys: [makeKey(t, value, easing)] };
}

/** The keyframes of a param ([] when it's a constant) — for timeline rendering. */
export function keysOf<T>(p: Param<T> | undefined): Keyframe<T>[] {
  return p && p.kind === 'keys' ? p.keys : [];
}

const SAME_T = 1e-3;

/** Index of the keyframe sitting at (about) time t, or -1. */
export function keyIndexAt<T>(p: Param<T> | undefined, t: number, tol = SAME_T): number {
  return keysOf(p).findIndex((k) => Math.abs(k.t - t) <= tol);
}

/** Add or update a keyframe at time t (const params become keyframed).
    A new keyframe inherits the easing of the key before it, so a track keeps
    its feel as you add to it. */
export function withKeyframe<T>(p: Param<T>, t: number, value: T): Param<T> {
  const keys = p.kind === 'keys' ? p.keys.map((k) => ({ ...k })) : [];
  const i = keys.findIndex((k) => Math.abs(k.t - t) < SAME_T);
  if (i >= 0) {
    keys[i].value = value;
  } else {
    const prev = [...keys].reverse().find((k) => k.t < t);
    keys.push({
      t,
      value,
      easeOut: prev?.easeOut ?? DEFAULT_EASE,
      easeIn: prev?.easeIn ?? DEFAULT_EASE,
    });
    keys.sort((a, b) => a.t - b.t);
  }
  return { kind: 'keys', keys };
}

/** Move keyframe `index` to time t. Returns the param plus the key's new index
    (the list stays sorted, so dragging one key past another renumbers them). */
export function moveKeyframe<T>(
  p: Param<T>,
  index: number,
  t: number,
): { param: Param<T>; index: number } {
  const keys = keysOf(p).map((k) => ({ ...k }));
  if (!keys[index]) return { param: p, index };
  const moved = keys[index];
  moved.t = t;
  keys.sort((a, b) => a.t - b.t);
  return { param: { kind: 'keys', keys }, index: keys.indexOf(moved) };
}

/** Remove keyframe `index`. The last remaining keyframe collapses to a constant
    so a param is never left with an empty (unresolvable) key list. */
export function removeKeyframe<T>(p: Param<T>, index: number): Param<T> {
  const keys = keysOf(p);
  if (!keys[index]) return p; // stale index (undo, concurrent edit) — leave it alone
  if (keys.length === 1) return { kind: 'const', value: keys[index].value };
  return { kind: 'keys', keys: keys.filter((_, i) => i !== index) };
}

/** Set one end of one keyframe's easing. */
export function setKeyEase<T>(
  p: Param<T>,
  index: number,
  side: 'in' | 'out',
  curve: EaseHalf,
): Param<T> {
  return mapKey(p, index, (k) => (side === 'in' ? { ...k, easeIn: curve } : { ...k, easeOut: curve }));
}

/** Toggle "hold" (step) on a keyframe. */
export function setKeyHold<T>(p: Param<T>, index: number, hold: boolean): Param<T> {
  return mapKey(p, index, (k) => ({ ...k, hold }));
}

/** Set every keyframe's easing at once (the "apply to whole track" action). */
export function setTrackEase<T>(p: Param<T>, out: EaseHalf, easeIn: EaseHalf): Param<T> {
  const keys = keysOf(p);
  if (!keys.length) return p;
  return { kind: 'keys', keys: keys.map((k) => ({ ...k, easeOut: out, easeIn })) };
}

function mapKey<T>(p: Param<T>, index: number, fn: (k: Keyframe<T>) => Keyframe<T>): Param<T> {
  const keys = keysOf(p);
  if (!keys[index]) return p;
  return { kind: 'keys', keys: keys.map((k, i) => (i === index ? fn(k) : k)) };
}

/** Collapse an animated param back to a constant, frozen at time t. */
export function flatten<T>(p: Param<T>, t: number): Param<T> {
  return { kind: 'const', value: resolveParam(p, t) };
}

/** Resolve a param's value at time t. Numbers interpolate; other types step. */
export function resolveParam<T>(p: Param<T>, t: number): T {
  if (p.kind === 'const') return p.value;
  const keys = p.keys;
  if (keys.length === 0) throw new Error('keyframed param has no keys');
  if (t <= keys[0].t) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.value;

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  if (a.hold) return a.value; // step: no interpolation out of a held key
  const span = b.t - a.t;
  const local = span <= 0 ? 0 : (t - a.t) / span;
  // The segment curve is composed from a's departure and b's arrival (see easing.ts).
  const k = segmentProgress(a.easeOut, b.easeIn, local);

  if (typeof a.value === 'number' && typeof b.value === 'number') {
    return ((a.value as number) + ((b.value as number) - (a.value as number)) * k) as T;
  }
  // Non-numeric values step at the incoming keyframe — on RAW segment time, not on
  // the eased k. The overshoot curves (back, elastic) exceed 1 partway through a
  // segment, so stepping on k fires the switch early and, for elastic, flips back
  // and forth several times. For every non-overshoot curve k < 1 ⟺ local < 1, so
  // this only changes behaviour where it was wrong.
  return local < 1 ? a.value : b.value;
}
