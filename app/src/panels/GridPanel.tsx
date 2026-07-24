import { resolveParam, type Param } from '../domain/params';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { ControlSlider } from '../ui/ControlSlider';

export function GridPanel() {
  const scene = useStudio((s) => s.scene);
  const setConstParam = useStudio((s) => s.setConstParam);
  const layer = scene.layers[0];
  const num = (key: string) => resolveParam(layer.params[key] as Param<number>, 0);
  const set = (key: string) => (v: number) => setConstParam(layer.id, key, v);

  return (
    <Panel title="Grid" defaultOpen>
      <ControlSlider label="Columns" value={num('cols')} min={4} max={240} onChange={set('cols')} />
      <ControlSlider label="Rows" value={num('rows')} min={3} max={140} onChange={set('rows')} />
      <ControlSlider
        label="Cell fill"
        value={num('density')}
        min={1}
        max={100}
        format={(v) => `${v}%`}
        onChange={set('density')}
      />
      <ControlSlider
        label="Symbol size"
        value={num('size')}
        min={6}
        max={200}
        format={(v) => `${v}px`}
        onChange={set('size')}
      />
      <ControlSlider
        label="Size jitter"
        value={num('sizeJit')}
        min={0}
        max={100}
        format={(v) => `${v}%`}
        onChange={set('sizeJit')}
      />
      <ControlSlider
        label="Position jitter"
        value={num('posJit')}
        min={0}
        max={100}
        format={(v) => `${v}%`}
        onChange={set('posJit')}
      />
      <ControlSlider
        label="Rotation"
        value={num('rotJit')}
        min={0}
        max={90}
        format={(v) => `${v}°`}
        onChange={set('rotJit')}
      />
    </Panel>
  );
}
