import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { Segmented } from '../ui/Segmented';

export function ModePanel() {
  const setLayerMode = useStudio((s) => s.setLayerMode);
  const layer = useActiveLayer();
  return (
    <Panel title="Mode" defaultOpen>
      <Segmented
        options={[
          { value: 'generative', label: 'Generative' },
          { value: 'ascii', label: 'ASCII' },
          { value: 'particle', label: 'Particles' },
        ]}
        value={layer.mode}
        onChange={(m) => setLayerMode(layer.id, m)}
      />
    </Panel>
  );
}
