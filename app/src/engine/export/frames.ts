/**
 * Rendering a frame that is actually finished.
 *
 * The live canvas can afford to paint what it has and repaint when more arrives. An
 * export cannot: it writes each frame exactly once, so a source still decoding would
 * silently become a blank or a duplicated frame in the file. These helpers close that
 * gap for every animated export (sequence, GIF, MP4) and for the single-frame ones.
 *
 * They work through the probe in `sourceReady.ts` rather than by inspecting sources
 * directly, which is what keeps them ignorant of grid sizes, frame indices and decode
 * state — the renderer asks for exactly what it needs and reports whether it got it.
 */
import type { Scene } from '../../domain/scene';
import { paintScene } from '../paint';
import { resolveScene } from '../placements';
import { beginSourceProbe, sourcePending, waitForSourceReady } from '../sourceReady';

/**
 * Cap on wait-and-retry rounds per frame. Reached only when sources keep arriving
 * without ever completing the frame; each round is bounded by the readiness timeout, so
 * this is a backstop against a livelock, not a latency budget.
 */
const MAX_ROUNDS = 24;

/** Did every source deliver, or did we give up? Reported so callers can say so. */
export type Settled = boolean;

/**
 * Paint `scene` at `t`, repainting until no source is still pending.
 *
 * The probe brackets the paint itself rather than a separate resolve pass: in the common
 * case (frame already decoded, or read-ahead got there first) that is one paint and no
 * waiting, and a halftone frame is far too expensive to resolve twice just to ask a
 * question about it.
 */
export async function paintSettled(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  t: number,
): Promise<{ settled: Settled; drawn: number }> {
  let drawn = 0;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    beginSourceProbe();
    drawn = paintScene(ctx, scene, t);
    if (sourcePending() === 0) return { settled: true, drawn };
    if (!(await waitForSourceReady())) return { settled: false, drawn };
  }
  return { settled: false, drawn };
}

/**
 * Wait until every source the scene reads at `t` has its data, without painting.
 *
 * For the exports that don't go through a canvas at all (SVG, JSON) and for the ones
 * that need the pixels ready before they set up their own context (PNG). Costs one
 * extra scene resolve, which is fine for a single frame.
 */
export async function settleSources(scene: Scene, t: number): Promise<Settled> {
  for (let i = 0; i < MAX_ROUNDS; i++) {
    beginSourceProbe();
    resolveScene(scene, t);
    if (sourcePending() === 0) return true;
    if (!(await waitForSourceReady())) return false;
  }
  return false;
}
