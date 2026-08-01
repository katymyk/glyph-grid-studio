/**
 * The scene's frame grid.
 *
 * `fps` used to be a number that only the exporters really believed in: the preview
 * advanced the playhead by wall-clock time on every animation frame, so a 12fps comp
 * played back as smoothly as a 60fps one and the setting had no visible effect. It is now
 * the preview's frame rate too, and this module is the one place seconds become frames.
 *
 * That matters beyond tidiness. The conversion was open-coded in eight places — the
 * transport readout, the keyframe snap, `stepFrame`, the morph inspector, the export
 * panel and all three exporters — and they agreed by luck. Every exporter writes frames
 * `0..frameCount-1`, so routing playback through the same function is what makes the
 * preview visit exactly the set of times the files contain.
 *
 * DOM-free and dependency-free, so `check:math` can compile it and node can exercise it.
 */

/** Structurally satisfied by `Scene` — declared here so this file imports nothing, the
    same reason `halftone/field.ts` declares its own `GrayField`. */
export interface TimeGrid {
  fps: number;
  duration: number;
}

/**
 * How many frames one loop contains.
 *
 * `round`, matching what every exporter already did. Note the consequence: at fps 25 and
 * duration 3.5 this is 88, and 88/25 = 3.52 > duration — so `timeOfFrame` clamps its
 * result rather than assuming the last frame lands inside the loop. Flooring instead would
 * change the frame count of every existing export, which is not worth the tidiness.
 */
export function frameCount(g: TimeGrid): number {
  return Math.max(1, Math.round(Math.max(0, g.fps) * Math.max(0, g.duration)));
}

/**
 * The frame a time falls on. Unclamped: callers that navigate clamp, callers that only
 * display want to know when they are past the end.
 *
 * Takes only the rate, not the whole grid, because that is all it reads — several callers
 * are display-only components holding `fps` and nothing else, and inventing a `duration`
 * for them would be a lie in the type.
 */
export function frameAt(g: Pick<TimeGrid, 'fps'>, t: number): number {
  return Math.round(t * Math.max(1, g.fps));
}

/** The time a frame sits at, clamped into the loop. */
export function timeOfFrame(g: TimeGrid, frame: number): number {
  const t = frame / Math.max(1, g.fps);
  return t < 0 ? 0 : t > g.duration ? g.duration : t;
}

/** Where a run of playback started, in the grid it started under. */
export interface PlayAnchor {
  frame: number;
  wallMs: number;
  fps: number;
}

/**
 * The frame a wall-clock instant maps to, looping at `total`.
 *
 * Derived from the anchor rather than accumulated, and that is the whole no-drift
 * argument: adding `dt` to a running total compounds every rounding error and every long
 * frame, so a ten-minute session ends up somewhere else entirely. Here the answer only
 * ever depends on how far `nowMs` is from the anchor.
 *
 * `floor` means a slow frame **skips** rather than replays. Deliberate: someone judging
 * timing needs real time, and a preview that quietly runs at 60% speed is worse than one
 * that drops frames.
 */
export function frameAtWall(a: PlayAnchor, nowMs: number, total: number): number {
  const n = Math.max(1, total);
  const elapsed = Math.max(0, nowMs - a.wallMs);
  const advanced = a.frame + Math.floor((elapsed / 1000) * Math.max(1, a.fps));
  return ((advanced % n) + n) % n;
}
