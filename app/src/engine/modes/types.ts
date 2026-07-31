import type { Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';

export interface ModeContext {
  width: number;
  height: number;
  time: number; // seconds; used by time-based modes (particles). Others may ignore it.
  /** Scene frame rate. Lets a mode derive a stable frame index — round(time * fps) —
      which is what per-frame determinism needs: quantising to frames means the
      preview and every exported frame ask for byte-identical source data, and an
      animated grain lands on the same value whether you scrub back or play forward. */
  fps: number;
}

/**
 * A render mode. Adding one (e.g. particles) means implementing this interface
 * and calling registerMode — nothing else in the app changes.
 */
export interface RenderMode {
  key: string;
  label: string;
  /** Fresh default params for a new layer of this mode. */
  defaultParams(): Record<string, Param<unknown>>;
  /**
   * Produce the placed elements for already-resolved params at some time t.
   * Both the canvas painter and the vector exporter consume this single list.
   */
  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[];
}
