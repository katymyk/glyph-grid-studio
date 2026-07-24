import type { ReactNode } from 'react';
import { resolveParam, type Param } from '../../domain/params';
import { useStudio } from '../../state/store';
import { Panel } from '../Panel';
import { ControlSlider } from '../ControlSlider';
import { Segmented } from '../Segmented';
import { TextField } from '../TextField';
import { Chips } from '../Chips';
import type { Control, PanelDef } from './types';

/**
 * The control registry: kind -> how to render it from a ui/ primitive. To change
 * which widget a kind uses (or add a new kind), edit/register here — nothing else
 * in the app changes. This is the swap point for logic-of-a-control.
 */
type RenderArgs = { control: Control; value: unknown; onChange: (v: unknown) => void };
const registry: Record<string, (a: RenderArgs) => ReactNode> = {
  slider: ({ control, value, onChange }) => {
    const c = control as Extract<Control, { kind: 'slider' }>;
    return (
      <ControlSlider
        label={c.label}
        min={c.min}
        max={c.max}
        step={c.step}
        format={c.format}
        value={typeof value === 'number' ? value : c.min}
        onChange={onChange}
      />
    );
  },
  segmented: ({ control, value, onChange }) => {
    const c = control as Extract<Control, { kind: 'segmented' }>;
    return <Segmented label={c.label} options={c.options} value={String(value)} onChange={onChange} />;
  },
  text: ({ control, value, onChange }) => {
    const c = control as Extract<Control, { kind: 'text' }>;
    const shown = c.serialize ? c.serialize(value) : String(value ?? '');
    return <TextField label={c.label} value={shown} onChange={(t) => onChange(c.parse ? c.parse(t) : t)} />;
  },
  chips: ({ control, value: _value, onChange }) => {
    const c = control as Extract<Control, { kind: 'chips' }>;
    return <Chips label={c.label} presets={c.presets} onSelect={onChange} />;
  },
};

export function registerControl(kind: string, render: (a: RenderArgs) => ReactNode) {
  registry[kind] = render;
}

/** Read a param's current value at the playhead (works for const + animated). */
function useParamValue(layerId: string, param: string): unknown {
  return useStudio((s) => {
    const layer = s.scene.layers.find((l) => l.id === layerId);
    return layer ? resolveParam(layer.params[param] as Param<unknown>, s.playhead) : undefined;
  });
}

/** Renders one control by looking its kind up in the registry and wiring it to the store. */
export function ControlView({ layerId, control }: { layerId: string; control: Control }) {
  const setConstParam = useStudio((s) => s.setConstParam);
  const value = useParamValue(layerId, control.param);
  const render = registry[control.kind];
  if (!render) return null;
  return <>{render({ control, value, onChange: (v) => setConstParam(layerId, control.param, v) })}</>;
}

/** Renders a whole panel (header + its controls) from a PanelDef. */
export function SchemaPanel({ layerId, def }: { layerId: string; def: PanelDef }) {
  return (
    <Panel title={def.title} defaultOpen={def.defaultOpen}>
      {def.controls.map((c, i) => (
        <ControlView key={`${c.param}:${i}`} layerId={layerId} control={c} />
      ))}
    </Panel>
  );
}
