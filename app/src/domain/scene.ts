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
  | 'dissolve'; // elements swap over one at a time (stipple)

/**
 * A mode change *inside one layer*: the layer renders its base mode, then over
 * [start, end] hands over to `mode` — e.g. start the animation as symbols and
 * end it as a halftone. The target keeps its own params (and its own keyframes),
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
 * Common to every placed element.
 *
 * `(x, y)` is ALWAYS the element's CENTRE, whatever it draws as. Glyphs are drawn
 * with textAlign/textBaseline centred, shapes are drawn centred on the origin after
 * `translate(x, y)`, SVG rotates about that point, and `applySpawn()`
 * (engine/placements.ts) tests it against the spawn mask. A mode that thinks in
 * top-left boxes (the dither pixel runs) converts before pushing, so all three of
 * those agree without special cases.
 */
interface PlacementBase {
  x: number;
  y: number;
  color: string;
  rotation: number; // radians
  alpha: number; // 0..1, per-element
}

/** A text mark. `shape` is optional so the glyph modes' literals stay unchanged. */
export interface GlyphPlacement extends PlacementBase {
  shape?: 'glyph';
  size: number; // font size in px
  glyph: string;
  weight: string;
  font: string; // resolved font stack
}

/**
 * What a non-text placement draws as. The geometry for each lives in
 * `engine/shapes.ts` — one module read by both the canvas painter and the SVG
 * exporter, so the two cannot disagree (§6).
 */
export type ShapeKind =
  | 'dot' // circle (ellipse when w !== h) — the halftone dot
  | 'square' // axis-aligned filled box
  | 'diamond' // quad inscribed in the w×h box
  | 'line' // filled bar: w = length, h = thickness
  | 'cross' // two crossed bars: w×h and h×w
  | 'ring' // stroked circle: w = outer diameter, h = ring thickness
  | 'pixel'; // a run of dither cells — a box, but exported with crispEdges

/** A geometric mark: `w`×`h` in local space, centred on (x, y), then rotated. */
export interface ShapePlacement extends PlacementBase {
  shape: ShapeKind;
  w: number;
  h: number;
}

/**
 * A fully-resolved element ready to draw or serialize. Carries everything a painter
 * or exporter needs, so both consume the exact same list (§6).
 *
 * This is a union on purpose: it makes "the painter and the exporters must agree"
 * a compile error rather than a comment. Add a ShapeKind and every renderer that
 * forgot it fails to build. It also keeps a halftone dot down to seven fields
 * instead of carrying meaningless glyph/weight/font — which matters when a frame
 * holds a hundred thousand of them.
 */
export type Placement = GlyphPlacement | ShapePlacement;

/** Narrow to the text case. Both `undefined` and `'glyph'` mean text. */
export function isGlyph(p: Placement): p is GlyphPlacement {
  return p.shape === undefined || p.shape === 'glyph';
}
