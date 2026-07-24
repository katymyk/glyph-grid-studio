import { getMode } from '../engine/modes';
import { resolveParam, type Param } from '../domain/params';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { ControlSlider } from '../ui/ControlSlider';
import styles from '../ui/ui.module.css';

const BLENDS: GlobalCompositeOperation[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
];
const blendLabel = (b: GlobalCompositeOperation) => (b === 'source-over' ? 'normal' : b.replace(/-/g, ' '));

export function LayersPanel() {
  const layers = useStudio((s) => s.scene.layers);
  const activeId = useStudio((s) => s.activeLayerId);
  const select = useStudio((s) => s.selectLayer);
  const add = useStudio((s) => s.addLayer);
  const remove = useStudio((s) => s.removeLayer);
  const move = useStudio((s) => s.moveLayer);
  const setVisible = useStudio((s) => s.setLayerVisible);
  const setOpacity = useStudio((s) => s.setLayerOpacity);
  const setBlend = useStudio((s) => s.setLayerBlend);

  const active = layers.find((l) => l.id === activeId) ?? layers[0];
  const opacity = resolveParam(active.opacity as Param<number>, 0);

  return (
    <Panel title="Layers" defaultOpen>
      <Button onClick={add}>+ Add layer</Button>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...layers].reverse().map((l, ri) => {
          const idx = layers.length - 1 - ri; // array index
          const isActive = l.id === activeId;
          return (
            <div
              key={l.id}
              onClick={() => select(l.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isActive ? 'var(--panel-2)' : 'transparent',
                borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setVisible(l.id, !l.visible);
                }}
                title={l.visible ? 'Hide' : 'Show'}
                style={{ background: 'none', border: 0, cursor: 'pointer', color: l.visible ? 'var(--text)' : 'var(--muted)', fontSize: 12, width: 16 }}
              >
                {l.visible ? '●' : '○'}
              </button>
              <span style={{ flex: 1, fontSize: 12, color: isActive ? 'var(--text)' : 'var(--muted)' }}>
                {l.name} · {getMode(l.mode).label}
              </span>
              <button onClick={(e) => { e.stopPropagation(); move(l.id, 1); }} disabled={idx === layers.length - 1}
                style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 11, opacity: idx === layers.length - 1 ? 0.3 : 1 }} title="Move up">▲</button>
              <button onClick={(e) => { e.stopPropagation(); move(l.id, -1); }} disabled={idx === 0}
                style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 11, opacity: idx === 0 ? 0.3 : 1 }} title="Move down">▼</button>
              <button onClick={(e) => { e.stopPropagation(); remove(l.id); }} disabled={layers.length <= 1}
                style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, opacity: layers.length <= 1 ? 0.3 : 1 }} title="Delete">×</button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <ControlSlider
          label="Layer opacity"
          value={Math.round(opacity * 100)}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onChange={(v) => setOpacity(active.id, v / 100)}
        />
        <Field label="Blend mode">
          <select
            className={styles.select}
            value={active.blendMode}
            onChange={(e) => setBlend(active.id, e.target.value as GlobalCompositeOperation)}
          >
            {BLENDS.map((b) => (
              <option key={b} value={b}>
                {blendLabel(b)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Panel>
  );
}
