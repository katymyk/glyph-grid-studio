import { resolveParam, type Param } from '../domain/params';
import { parseGlyphs } from '../lib/glyphs';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import styles from '../ui/ui.module.css';

const PRESETS: { name: string; set: string }[] = [
  { name: 'strokes', set: '/ \\ < > -' },
  { name: 'dots', set: '• ◦ ● ○' },
  { name: 'binary', set: '0 1' },
  { name: 'letters', set: 'A B C D E F' },
  { name: 'arrows', set: '↑ ↗ → ↘ ↓ ↙ ← ↖' },
  { name: 'math', set: '+ × ÷ = ≈ ∞' },
];

export function ContentPanel() {
  const scene = useStudio((s) => s.scene);
  const setConstParam = useStudio((s) => s.setConstParam);
  const layer = scene.layers[0];
  const glyphs = resolveParam(layer.params.glyphs as Param<string[]>, 0);

  const setGlyphs = (text: string) => setConstParam(layer.id, 'glyphs', parseGlyphs(text));

  return (
    <Panel title="Content" defaultOpen>
      <Field label="Symbols / text (space or line separated)">
        <textarea
          className={styles.textarea}
          value={glyphs.join(' ')}
          onChange={(e) => setGlyphs(e.target.value)}
        />
      </Field>
      <Field label="Quick sets">
        <div className={styles.chips}>
          {PRESETS.map((p) => (
            <button key={p.name} className={styles.chip} onClick={() => setGlyphs(p.set)}>
              {p.name}
            </button>
          ))}
        </div>
      </Field>
    </Panel>
  );
}
