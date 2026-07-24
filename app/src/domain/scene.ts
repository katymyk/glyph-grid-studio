import type { Param } from './params';

/** Restricts where a layer's elements may appear. Applied centrally after a mode
    produces placements, so every mode + export respects it uniformly. */
export type SpawnZone =
  | { kind: 'full' }
  | { kind: 'image'; image: string | null; invert: boolean };

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
