import type { Param } from './params';

/** A layer applies one render mode with its own animatable params. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  mode: string; // key into the mode registry
  opacity: Param<number>; // 0..1
  blendMode: GlobalCompositeOperation;
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
