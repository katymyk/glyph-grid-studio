import { ease, type Easing } from './easing';

export interface Keyframe<T> {
  t: number; // seconds
  value: T;
  easing: Easing;
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

/** Two-keyframe animated param (the common "start -> end" case). */
export function ramp<T>(
  from: T,
  to: T,
  duration: number,
  easing: Easing = 'easeInOut',
): Param<T> {
  return {
    kind: 'keys',
    keys: [
      { t: 0, value: from, easing },
      { t: duration, value: to, easing },
    ],
  };
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
  const span = b.t - a.t;
  const local = span <= 0 ? 0 : (t - a.t) / span;
  const k = ease(b.easing, local);

  if (typeof a.value === 'number' && typeof b.value === 'number') {
    return ((a.value as number) + ((b.value as number) - (a.value as number)) * k) as T;
  }
  // Non-numeric values step at the incoming keyframe.
  return k < 1 ? a.value : b.value;
}
