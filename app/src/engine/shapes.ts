import type { ShapeKind } from '../domain/scene';

/**
 * Shape geometry, in ONE place.
 *
 * `engine/paint.ts` (canvas) and `engine/export/svg.ts` (vector) draw the same
 * Placement list (ARCHITECTURE.md §6). If each computed its own diamond corners or
 * its own ring radius they would drift — the exact bug the single-render-path rule
 * exists to prevent. So both import from here.
 */

/** Diamond corners in local space (centre 0,0), clockwise from the top. Shared so
    the canvas path and the SVG <polygon> describe the same quad. */
export function diamondPoints(w: number, h: number): [number, number][] {
  return [
    [0, -h / 2],
    [w / 2, 0],
    [0, h / 2],
    [-w / 2, 0],
  ];
}

/**
 * Ring stroke geometry: the centreline radius, so the ring's OUTER edge lands on
 * `w`. Returns null when the thickness has swallowed the hole — both renderers then
 * draw a solid dot, which is the only sensible degenerate case.
 */
export function ringRadius(w: number, h: number): number | null {
  const r = (w - h) / 2;
  return r > 0 ? r : null;
}

/** Shapes whose paint state is just (fillStyle, globalAlpha), so consecutive ones
    can be batched into a single canvas fill. 'ring' strokes and is excluded. */
export function isBatchable(shape: ShapeKind): boolean {
  return shape === 'dot' || shape === 'square' || shape === 'pixel';
}

/** Compile-time exhaustiveness guard: a new ShapeKind that paint.ts or svg.ts forgot
    to handle is a type error, not a silently invisible element. */
export function assertNeverShape(s: never): never {
  throw new Error(`unhandled placement shape: ${String(s)}`);
}
