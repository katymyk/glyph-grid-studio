import { useState } from 'react';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { download } from '../lib/download';
import { sceneToSVG } from '../engine/export/svg';
import { sceneToJSON } from '../engine/export/json';
import { sceneToPNGBlob } from '../engine/export/png';
import { sceneToGIF } from '../engine/export/gif';
import { sceneToSequence } from '../engine/export/sequence';
import styles from '../ui/ui.module.css';

export function ExportPanel() {
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);
  const setFps = useStudio((s) => s.setFps);
  const [busy, setBusy] = useState<string | null>(null);

  const frames = Math.max(1, Math.round(scene.fps * scene.duration));

  const exSVG = () =>
    download(new Blob([sceneToSVG(scene, playhead)], { type: 'image/svg+xml' }), 'glyph-grid.svg');
  const exJSON = () =>
    download(new Blob([sceneToJSON(scene, playhead)], { type: 'application/json' }), 'glyph-grid.json');
  const exPNG = async () => download(await sceneToPNGBlob(scene, playhead, 2), 'glyph-grid@2x.png');

  const runGIF = async () => {
    setBusy('gif:0');
    try {
      const blob = await sceneToGIF(scene, (p) => setBusy(`gif:${Math.round(p * 100)}`));
      download(blob, `glyph-grid_${scene.fps}fps.gif`);
    } finally {
      setBusy(null);
    }
  };
  const runSeq = async () => {
    setBusy('seq:0');
    try {
      const blob = await sceneToSequence(scene, (p) => setBusy(`seq:${Math.round(p * 100)}`));
      download(blob, `glyph-sequence_${scene.fps}fps.zip`);
    } finally {
      setBusy(null);
    }
  };

  const gifLabel = busy?.startsWith('gif') ? `GIF… ${busy.split(':')[1]}%` : 'GIF (animated)';
  const seqLabel = busy?.startsWith('seq') ? `Frames… ${busy.split(':')[1]}%` : 'PNG sequence (.zip)';

  return (
    <Panel title="Export">
      <div className={styles.btnGrid}>
        <Button onClick={exSVG}>SVG · Figma</Button>
        <Button onClick={exPNG}>PNG · 2×</Button>
      </div>
      <div style={{ marginTop: 6 }}>
        <Button onClick={exJSON}>JSON · coords for AE</Button>
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <Field label={`Animation · ${frames} frames @ ${scene.fps} fps`}>
          <input
            className={styles.numberInput}
            type="number"
            min={1}
            max={60}
            value={scene.fps}
            onChange={(e) => setFps(Number(e.target.value))}
          />
        </Field>
        <Button onClick={runGIF} disabled={busy !== null}>
          {gifLabel}
        </Button>
        <div style={{ marginTop: 6 }}>
          <Button onClick={runSeq} disabled={busy !== null}>
            {seqLabel}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
