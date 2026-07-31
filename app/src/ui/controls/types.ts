/**
 * A control is DATA describing one input: its kind, which param it binds to, and
 * display metadata. Panels are ordered lists of these. Rearranging, relabeling, or
 * regrouping controls = editing this data — no component code changes. Presentation
 * lives in the ui/ primitives; the control registry maps kind -> primitive.
 */

/** Canvas facts a readout may need. Deliberately narrow — a control should not be
    able to reach into the whole store. */
export interface ControlScene {
  width: number;
  height: number;
}

/** Shared by every kind, so a new cross-cutting concern is added in one place. */
interface ControlBase {
  param: string;
  label: string;
  /**
   * Show this control only when the predicate holds for the layer's other resolved
   * params. A mode with several methods (halftone's dot screen vs its threshold
   * algorithms) has controls that only apply to one of them; without this, half the
   * sidebar is sliders that provably do nothing.
   */
  when?: (params: Record<string, unknown>) => boolean;
  /** Write to the base mode AND the morph target, so a handover keeps this in sync. */
  shared?: boolean;
}

export type Control =
  | (ControlBase & {
      kind: 'slider';
      min: number;
      max: number;
      step?: number;
      format?: (v: number) => string;
    })
  | (ControlBase & { kind: 'segmented'; options: { value: string; label: string }[] })
  /** Like segmented, but for more options than fit across a 330px sidebar. */
  | (ControlBase & { kind: 'select'; options: { value: string; label: string }[] })
  | (ControlBase & { kind: 'toggle' })
  | (ControlBase & {
      kind: 'text';
      serialize?: (v: unknown) => string;
      parse?: (s: string) => unknown;
    })
  | (ControlBase & { kind: 'chips'; presets: { label: string; value: unknown }[] })
  /**
   * Read-only derived text. Exists so a computed limit can be DISCLOSED: a slider's
   * `format` only sees its own value, so it cannot say "cell 3px → 7.2px, 40,000
   * dots". A cap the user cannot see is indistinguishable from a bug.
   */
  | (ControlBase & {
      kind: 'readout';
      compute: (params: Record<string, unknown>, scene: ControlScene) => string;
    });

export interface PanelDef {
  id: string;
  title: string;
  defaultOpen?: boolean;
  controls: Control[];
}
