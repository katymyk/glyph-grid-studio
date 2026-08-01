import { resolveParam, type Param } from '../domain/params';
import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { ControlSlider } from '../ui/ControlSlider';
import { Button } from '../ui/Button';

export function SeedPanel() {
  const setSharedParam = useStudio((s) => s.setSharedParam);
  const layer = useActiveLayer();
  // Guard the read, not the result — see the note in ColorsPanel.
  const seedParam = layer.params.seed as Param<number> | undefined;
  const seed = seedParam ? ((resolveParam(seedParam, 0) as number) ?? 1) : 1;

  return (
    <Panel title="Randomness">
      <ControlSlider
        label="Seed"
        value={seed}
        min={1}
        max={9999}
        onChange={(v) => setSharedParam(layer.id, 'seed', v)}
      />
      <Button onClick={() => setSharedParam(layer.id, 'seed', Math.floor(Math.random() * 9999) + 1)}>
        🎲 New layout (same settings)
      </Button>
    </Panel>
  );
}
