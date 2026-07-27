import { segmentProgress, type EaseHalf } from './easing';
import type { Param } from './params';

/** Restricts where a layer's elements may appear. Applied centrally after a mode
    produces placements, so every mode + export respects it uniformly. */
export type SpawnZone =
  | { kind: 'full' }
  | { kind: 'image'; image: string | null; invert: boolean }
  | { kind: 'brush'; mask: string | null; invert: boolean };

/** How a layer hands over from its base mode to its morph target. */
export type MorphStyle =
  | 'fade' // both modes overlap, one alpha-fades out while the other fades in
  | 'dissolve'; // elements swap over one at a time (stipple/particle-ise)

/**
 * A mode change *inside one layer*: the layer renders its base mode, then over
 * [start, end] hands over to `mode` — e.g. start the animation as symbols and
 * end it as particles. The target keeps its own params (and its own keyframes),
 * so both halves are dialled in independently.
 */
export interface LayerMorph {
  mode: string; // registry key of the target mode
  params: Record<string, Param<unknown>>; // target mode's params
  start: number; // seconds
  end: number; // seconds
  style: MorphStyle;
  /** Curve of the handover, same two-half model as a keyframe pair. */
  easeOut: EaseHalf; // leaving `start`
  easeIn: EaseHalf; // arriving at `end`
}

/** A layer applies one render mode with its own animatable params. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  mode: string; // key into the mode registry
  opacity: Param<number>; // 0..1
  blendMode: GlobalCompositeOperation;
  spawn: SpawnZone;
  params: Record<string, Param<unknown>>;
  /** Optional mid-animation mode change. null = the layer is one mode throughout. */
  morph: LayerMorph | null;
}

/** The whole document: a canvas + timeline + a stack of layers (bottom -> top). */
export interface Scene {
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  background: string | null; // null = transparent
  layers: Layer[];
}

/** Handover weight at time t: 0 = all base mode, 1 = all target mode. */
export function morphProgress(m: LayerMorph, t: number): number {
  if (t <= m.start) return 0;
  if (t >= m.end) return 1;
  const span = m.end - m.start;
  if (span <= 0) return 1;
  const p = segmentProgress(m.easeOut, m.easeIn, (t - m.start) / span);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * A fully-resolved element ready to draw or serialize. Carries everything a
 * painter or exporter needs, so both consume the exact same list (§6).
 */
export interface Placement {
  x: number;
  y: number;
  size: number;
  glyph: string;
  color: string;
  rotation: number; // radians
  alpha: number; // 0..1, per-element
  weight: string;
  font: string; // resolved font stack
}
