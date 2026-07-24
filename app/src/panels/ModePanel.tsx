import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Segmented } from '../ui/Segmented';

export function ModePanel() {
  const scene = useStudio((s) => s.scene);
  const setLayerMode = useStudio((s) => s.setLayerMode);
  const layer = scene.layers[0];
  return (
    <Panel title="Mode" defaultOpen>
      <Segmented
        options={[
          { value: 'generative', label: 'Generative' },
          { value: 'ascii', label: 'ASCII' },
        ]}
        value={layer.mode}
        onChange={(m) => setLayerMode(layer.id, m)}
      />
    </Panel>
  );
}
