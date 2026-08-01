import { listModes } from '../engine/modes';
import { frameAt } from '../domain/timeline';
import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { Segmented } from '../ui/Segmented';
import { Field } from '../ui/Field';
import styles from '../ui/ui.module.css';

/**
 * Mode picker for the layer, plus the *mode morph*: a second mode this layer hands
 * over to partway through the animation (start as symbols, end as particles). The
 * handover range and curve live on the timeline; this panel just arms it.
 */
export function ModePanel() {
  const setLayerMode = useStudio((s) => s.setLayerMode);
  const setMorphMode = useStudio((s) => s.setMorphMode);
  const fps = useStudio((s) => s.scene.fps);
  const layer = useActiveLayer();
  const modes = listModes();

  return (
    <Panel title="Mode" defaultOpen>
      <Segmented
        options={modes.map((m) => ({ value: m.key, label: m.label }))}
        value={layer.mode}
        onChange={(m) => setLayerMode(layer.id, m)}
      />

      <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <Field label="Morph into (mid-animation mode change)">
          <select
            className={styles.select}
            value={layer.morph?.mode ?? ''}
            onChange={(e) => setMorphMode(layer.id, e.target.value || null)}
          >
            <option value="">No morph — one mode throughout</option>
            {modes
              .filter((m) => m.key !== layer.mode)
              .map((m) => (
                <option key={m.key} value={m.key}>
                  → {m.label}
                </option>
              ))}
          </select>
        </Field>
        <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, margin: '2px 0 0' }}>
          {layer.morph
            ? `Hands over frames ${frameAt({ fps }, layer.morph.start)}–${frameAt({ fps }, layer.morph.end)}. Drag the bar on the timeline to retime it; select it to set the curve.`
            : 'Pick a second mode to start the animation in this mode and end it in that one.'}
        </p>
      </div>
    </Panel>
  );
}
