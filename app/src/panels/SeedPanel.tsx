import { resolveParam, type Param } from '../domain/params';
import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { ControlSlider } from '../ui/ControlSlider';
import { Button } from '../ui/Button';

export function SeedPanel() {
  const setConstParam = useStudio((s) => s.setConstParam);
  const layer = useActiveLayer();
  const seed = (resolveParam(layer.params.seed as Param<number>, 0) as number) ?? 1;

  return (
    <Panel title="Randomness">
      <ControlSlider
        label="Seed"
        value={seed}
        min={1}
        max={9999}
        onChange={(v) => setConstParam(layer.id, 'seed', v)}
      />
      <Button onClick={() => setConstParam(layer.id, 'seed', Math.floor(Math.random() * 9999) + 1)}>
        🎲 New layout (same settings)
      </Button>
    </Panel>
  );
}
