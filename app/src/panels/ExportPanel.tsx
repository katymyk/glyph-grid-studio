import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { download } from '../lib/download';
import { sceneToSVG } from '../engine/export/svg';
import { sceneToJSON } from '../engine/export/json';
import { sceneToPNGBlob } from '../engine/export/png';
import styles from '../ui/ui.module.css';

export function ExportPanel() {
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);

  const exSVG = () =>
    download(new Blob([sceneToSVG(scene, playhead)], { type: 'image/svg+xml' }), 'glyph-grid.svg');
  const exJSON = () =>
    download(new Blob([sceneToJSON(scene, playhead)], { type: 'application/json' }), 'glyph-grid.json');
  const exPNG = async () => download(await sceneToPNGBlob(scene, playhead, 2), 'glyph-grid@2x.png');

  return (
    <Panel title="Export">
      <div className={styles.btnGrid}>
        <Button onClick={exSVG}>SVG · Figma</Button>
        <Button onClick={exPNG}>PNG · 2×</Button>
      </div>
      <div style={{ marginTop: 6 }}>
        <Button onClick={exJSON}>JSON · coords for AE</Button>
      </div>
    </Panel>
  );
}
