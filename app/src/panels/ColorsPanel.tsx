import { useState } from 'react';
import { resolveParam, type Param } from '../domain/params';
import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import { ColorField } from '../ui/ColorField';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';

/** Bespoke panel: background (color + transparent) and an editable palette list. */
export function ColorsPanel() {
  const scene = useStudio((s) => s.scene);
  const setBackground = useStudio((s) => s.setBackground);
  const setConstParam = useStudio((s) => s.setConstParam);
  const [lastBg, setLastBg] = useState('#ffffff');

  const layer = useActiveLayer();
  const palette = (resolveParam(layer.params.palette as Param<string[]>, 0) as string[]) ?? [];
  const transparent = scene.background === null;
  const setPalette = (arr: string[]) => setConstParam(layer.id, 'palette', arr);

  return (
    <Panel title="Colors">
      {!transparent && (
        <Field label="Background">
          <ColorField
            value={scene.background ?? '#ffffff'}
            onChange={(v) => {
              setLastBg(v);
              setBackground(v);
            }}
          />
        </Field>
      )}
      <Toggle
        label="Transparent background"
        checked={transparent}
        onChange={(on) => setBackground(on ? null : lastBg)}
      />
      <Field label="Element palette">
        {palette.map((c, i) => (
          <ColorField
            key={i}
            value={c}
            onChange={(v) => setPalette(palette.map((x, j) => (j === i ? v : x)))}
            onRemove={palette.length > 1 ? () => setPalette(palette.filter((_, j) => j !== i)) : undefined}
          />
        ))}
      </Field>
      <Button onClick={() => setPalette([...palette, '#888888'])}>+ Add color</Button>
    </Panel>
  );
}
