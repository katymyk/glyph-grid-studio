import type { ReactNode } from 'react';
import { resolveParam, type Param } from '../../domain/params';
import { readSlotParam, resolveSlotParams, useStudio, type Slot } from '../../state/store';
import { Panel } from '../Panel';
import { ControlSlider } from '../ControlSlider';
import { Segmented } from '../Segmented';
import { Select } from '../Select';
import { Readout } from '../Readout';
import { TextField } from '../TextField';
import { Chips } from '../Chips';
import { Toggle } from '../Toggle';
import { KeyToggle } from '../KeyToggle';
import type { Control, PanelDef } from './types';

/**
 * The control registry: kind -> how to render it from a ui/ primitive. To change
 * which widget a kind uses (or add a new kind), edit/register here — nothing else
 * in the app changes. This is the swap point for logic-of-a-control.
 */
type RenderArgs = {
  control: Control;
  value: unknown;
  onChange: (v: unknown) => void;
  animated?: boolean;
  onToggleAnimate?: () => void;
};
const registry: Record<string, (a: RenderArgs) => ReactNode> = {
  slider: ({ control, value, onChange, animated, onToggleAnimate }) => {
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
        animated={animated}
        onToggleAnimate={onToggleAnimate}
      />
    );
  },
  segmented: ({ control, value, onChange, animated, onToggleAnimate }) => {
    const c = control as Extract<Control, { kind: 'segmented' }>;
    return (
      <Segmented
        label={c.label}
        options={c.options}
        value={String(value)}
        onChange={onChange}
        action={onToggleAnimate ? <KeyToggle animated={animated} onToggle={onToggleAnimate} /> : undefined}
      />
    );
  },
  select: ({ control, value, onChange, animated, onToggleAnimate }) => {
    const c = control as Extract<Control, { kind: 'select' }>;
    return (
      <Select
        label={c.label}
        options={c.options}
        value={String(value)}
        onChange={onChange}
        action={onToggleAnimate ? <KeyToggle animated={animated} onToggle={onToggleAnimate} /> : undefined}
      />
    );
  },
  toggle: ({ control, value, onChange, animated, onToggleAnimate }) => {
    const c = control as Extract<Control, { kind: 'toggle' }>;
    return (
      <Toggle
        label={c.label}
        checked={Boolean(value)}
        onChange={onChange}
        action={onToggleAnimate ? <KeyToggle animated={animated} onToggle={onToggleAnimate} /> : undefined}
      />
    );
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

/** Which control kinds can be keyed. Stepped kinds (segmented/select/toggle) animate
    as hard switches; free text and preset chips stay constant. */
const ANIMATABLE = new Set(['slider', 'segmented', 'select', 'toggle']);

/**
 * Renders one control from the registry, wired to the store. When the param is
 * animated, edits upsert a keyframe at the playhead instead of a constant.
 *
 * Slot-agnostic: the same component drives a mode param, a morph target's param, layer
 * opacity, or a scene param (`slot: 'scene'`, `layerId: SCENE_LAYER`). That is what lets
 * the Source panel's clip offset be an ordinary keyable slider without a second code path.
 */
export function ControlView({
  layerId,
  control,
  slot = 'base',
}: {
  layerId: string;
  control: Control;
  slot?: Slot;
}) {
  const setConstParam = useStudio((s) => s.setConstParam);
  const setSharedParam = useStudio((s) => s.setSharedParam);
  const upsertKeyframe = useStudio((s) => s.upsertKeyframe);
  const toggleParamAnimated = useStudio((s) => s.toggleParamAnimated);
  const playhead = useStudio((s) => s.playhead);
  const param = useStudio((s) => readSlotParam(s.scene, layerId, slot, control.param));
  const animated = param?.kind === 'keys';
  const value = param ? resolveParam(param as Param<unknown>, playhead) : undefined;
  const render = registry[control.kind];
  if (!render) return null;

  const onChange = (v: unknown) => {
    if (animated) upsertKeyframe(layerId, control.param, playhead, v, slot);
    else if (control.shared) setSharedParam(layerId, control.param, v);
    else setConstParam(layerId, control.param, v, slot);
  };
  const onToggleAnimate = ANIMATABLE.has(control.kind)
    ? () => toggleParamAnimated(layerId, control.param, playhead, slot)
    : undefined;

  return <>{render({ control, value, onChange, animated, onToggleAnimate })}</>;
}

/**
 * Field separator for the packed selector result below.
 *
 * NUL specifically: readout text is arbitrary human-readable string — it carries
 * spaces, digits, punctuation and non-ASCII — so any printable delimiter would
 * eventually mis-split the fields and shift every readout onto the wrong control.
 */
const SEP = '\u0000';

/**
 * Renders a whole panel (header + its controls) from a PanelDef.
 *
 * Visibility (`when`) and readout text both depend on the layer's OTHER resolved
 * params, which means one subscription that sees them all. Returning that as a
 * derived object would give a fresh identity on every store change — including every
 * playhead tick during playback — and re-render the panel each time. So the selector
 * packs everything into a single string: cheap to compare, stable when nothing it
 * cares about moved.
 */
export function SchemaPanel({
  layerId,
  def,
  slot = 'base',
  titlePrefix = '',
  defaultOpen,
}: {
  layerId: string;
  def: PanelDef;
  slot?: Slot;
  titlePrefix?: string;
  defaultOpen?: boolean;
}) {
  const packed = useStudio((s) => {
    const l = s.scene.layers.find((x) => x.id === layerId);
    if (!l) return '';
    const resolved = resolveSlotParams(l, slot, s.playhead);
    const scene = { width: s.scene.width, height: s.scene.height };
    const flags = def.controls.map((c) => (c.when ? (c.when(resolved) ? '1' : '0') : '1')).join('');
    const outs = def.controls.map((c) =>
      c.kind === 'readout' ? c.compute(resolved, scene) : '',
    );
    return flags + SEP + outs.join(SEP);
  });

  if (!packed) return null;
  const [flags, ...outs] = packed.split(SEP);
  const shown = def.controls.filter((_, i) => flags[i] === '1');
  // Every control in this group is inactive for the current settings — hide the
  // group rather than show an empty box. (The Panel is uncontrolled, so a group that
  // comes back re-opens; acceptable, and cheaper than lifting collapse state.)
  if (shown.length === 0) return null;

  return (
    <Panel title={`${titlePrefix}${def.title}`} defaultOpen={defaultOpen ?? def.defaultOpen}>
      {def.controls.map((c, i) => {
        if (flags[i] !== '1') return null;
        // Readouts render here, not through ControlView: ControlView runs hooks, and
        // returning early from it for one kind would change the hook count between
        // renders.
        if (c.kind === 'readout') {
          return <Readout key={`${c.param}:${i}`} label={c.label} value={outs[i] ?? ''} />;
        }
        return <ControlView key={`${c.param}:${i}`} layerId={layerId} control={c} slot={slot} />;
      })}
    </Panel>
  );
}
