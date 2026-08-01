import { useState } from 'react';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import styles from '../ui/ui.module.css';

const PRESETS: Record<string, [number, number]> = {
  hd: [1920, 1080],
  vertical: [1080, 1920],
  square: [1080, 1080],
  uhd: [3840, 2160],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function CanvasPanel() {
  const scene = useStudio((s) => s.scene);
  const setCanvasSize = useStudio((s) => s.setCanvasSize);
  const [w, setW] = useState(String(scene.width));
  const [h, setH] = useState(String(scene.height));

  const apply = () => {
    const W = clamp(Math.round(Number(w)) || scene.width, 100, 8000);
    const H = clamp(Math.round(Number(h)) || scene.height, 100, 8000);
    setW(String(W));
    setH(String(H));
    setCanvasSize(W, H);
  };
  const onPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setW(String(p[0]));
    setH(String(p[1]));
    setCanvasSize(p[0], p[1]);
  };

  return (
    <Panel title="Canvas">
      <Field label="Preset">
        <select className={styles.select} value="" onChange={(e) => onPreset(e.target.value)}>
          <option value="" disabled>
            Choose a preset…
          </option>
          <option value="hd">1920 × 1080 — HD landscape</option>
          <option value="vertical">1080 × 1920 — vertical</option>
          <option value="square">1080 × 1080 — square</option>
          <option value="uhd">3840 × 2160 — 4K</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label="Width, px">
            <input className={styles.numberInput} type="number" value={w} onChange={(e) => setW(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Height, px">
            <input className={styles.numberInput} type="number" value={h} onChange={(e) => setH(e.target.value)} />
          </Field>
        </div>
      </div>
      <Button variant="primary" onClick={apply}>
        Apply size
      </Button>
    </Panel>
  );
}
