import type { Param } from '../../domain/params';
import type { Placement } from '../../domain/scene';

export interface ModeContext {
  width: number;
  height: number;
  time: number; // seconds; used by time-based modes (a video source). Others may ignore it.
  /** Scene frame rate. Lets a mode derive a stable frame index — round(time * fps) —
      which is what per-frame determinism needs: quantising to frames means the
      preview and every exported frame ask for byte-identical source data, and an
      animated grain lands on the same value whether you scrub back or play forward. */
  fps: number;
  /**
   * The composition's source: an image data URL, a `video:N` clip reference, or null.
   *
   * It arrives as CONTEXT, not as a param, because it belongs to the scene rather than
   * to the layer (see `SceneSource`). That is what makes one canvas / many treatments
   * work: every mode in the stack is handed the same picture, and a mode switch cannot
   * take it away because the mode never owned it.
   */
  source: string | null;
  /** The scene's clip offset resolved at `time`. Added to `time` to pick the source
      frame; inert for a still image. */
  srcTime: number;
}

/**
 * A render mode. Adding one means implementing this interface
 * and calling registerMode — nothing else in the app changes.
 */
export interface RenderMode {
  key: string;
  label: string;
  /** True when this mode screens `ctx.source`. Purely descriptive — it lets the Source
      panel say whether the loaded picture is actually being used by anything, instead of
      sitting there implying it is. */
  readsSource?: boolean;
  /** Fresh default params for a new layer of this mode. */
  defaultParams(): Record<string, Param<unknown>>;
  /**
   * Produce the placed elements for already-resolved params at some time t.
   * Both the canvas painter and the vector exporter consume this single list.
   */
  placements(resolved: Record<string, unknown>, ctx: ModeContext): Placement[];
}
