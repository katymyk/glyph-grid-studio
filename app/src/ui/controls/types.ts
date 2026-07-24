/**
 * A control is DATA describing one input: its kind, which param it binds to, and
 * display metadata. Panels are ordered lists of these. Rearranging, relabeling, or
 * regrouping controls = editing this data — no component code changes. Presentation
 * lives in the ui/ primitives; the control registry maps kind -> primitive.
 */
export type Control =
  | { kind: 'slider'; param: string; label: string; min: number; max: number; step?: number; format?: (v: number) => string }
  | { kind: 'segmented'; param: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'toggle'; param: string; label: string }
  | { kind: 'text'; param: string; label: string; serialize?: (v: unknown) => string; parse?: (s: string) => unknown }
  | { kind: 'chips'; param: string; label: string; presets: { label: string; value: unknown }[] };

export interface PanelDef {
  id: string;
  title: string;
  defaultOpen?: boolean;
  controls: Control[];
}
