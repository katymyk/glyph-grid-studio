import { useState } from 'react';
import { useStudio } from '../state/store';
import { frameCount } from '../domain/timeline';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Readout } from '../ui/Readout';
import { download } from '../lib/download';
import { sceneToSVG } from '../engine/export/svg';
import { sceneToJSON } from '../engine/export/json';
import { sceneToPNGBlob } from '../engine/export/png';
import { gifButtonLabel, sceneToGIF } from '../engine/export/gif';
import { sceneToSequence } from '../engine/export/sequence';
import { MP4_UNSUPPORTED, mp4Supported, sceneToMP4 } from '../engine/export/mp4';
import { settleSources } from '../engine/export/frames';
import styles from '../ui/ui.module.css';

/** Above roughly this many elements, a vector export is slow to write, heavy to open,
    and hard on Figma — so it is worth confirming rather than just doing. */
const CONFIRM_ELEMENTS = 40000;

export function ExportPanel() {
  const scene = useStudio((s) => s.scene);
  const playhead = useStudio((s) => s.playhead);
  const setFps = useStudio((s) => s.setFps);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A successful export that still needs to say something (e.g. it fell back a codec). */
  const [note, setNote] = useState<string | null>(null);
  // Synchronous feature test, so the button can be honestly disabled without pulling in
  // the encoder bundle just to ask the question.
  const canMP4 = mp4Supported();

  const frames = frameCount(scene);
  // Reported by the Stage's last paint rather than recomputed here — resolving the
  // scene a second time would double the cost of every edit. A halftone screen can
  // reach six figures, which is what makes this worth showing before an export.
  const elements = useStudio((s) => s.elementCount);

  const heavyOk = (kind: string) =>
    elements < CONFIRM_ELEMENTS ||
    window.confirm(
      `This frame has ${elements.toLocaleString('en-US')} elements. The ${kind} file will be ` +
        `large and may be slow to open. Continue?`,
    );

  /** Wrap an export: one progress slot, and a failure the user can actually read. */
  const run = async (tag: string, job: (onProgress: (p: number) => void) => Promise<void>) => {
    // Stop the transport first. The engine already refuses to write a substituted frame
    // (frames.ts latches 'exact'), so this is manners rather than the guarantee — but
    // without it the playback loop keeps fighting the export for the decoder.
    useStudio.getState().pause();
    setBusy(`${tag}:0`);
    setError(null);
    setNote(null);
    try {
      await job((p) => setBusy(`${tag}:${Math.round(p * 100)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // The vector/data exports read the frame at the playhead, which a video source may
  // still be seeking — settle first, or the file gets whatever was on screen.
  const exSVG = () =>
    run('svg', async () => {
      if (!heavyOk('SVG')) return;
      await settleSources(scene, playhead);
      download(new Blob([sceneToSVG(scene, playhead)], { type: 'image/svg+xml' }), 'glyph-grid.svg');
    });
  const exJSON = () =>
    run('json', async () => {
      if (!heavyOk('JSON')) return;
      await settleSources(scene, playhead);
      download(new Blob([sceneToJSON(scene, playhead)], { type: 'application/json' }), 'glyph-grid.json');
    });
  const exPNG = () =>
    run('png', async () => download(await sceneToPNGBlob(scene, playhead, 2), 'glyph-grid@2x.png'));

  const runGIF = () =>
    run('gif', async (onProgress) =>
      download(await sceneToGIF(scene, onProgress), `glyph-grid_${scene.fps}fps.gif`),
    );
  const runSeq = () =>
    run('seq', async (onProgress) =>
      download(await sceneToSequence(scene, onProgress), `glyph-sequence_${scene.fps}fps.zip`),
    );
  const runMP4 = () =>
    run('mp4', async (onProgress) => {
      const { blob, codec } = await sceneToMP4(scene, onProgress);
      // Name the codec when H.264 wasn't available. A silent HEVC-in-MP4 that Premiere
      // refuses to open is worse than a longer filename.
      const suffix = codec === 'avc' ? '' : `_${codec}`;
      download(blob, `glyph-grid_${scene.fps}fps${suffix}.mp4`);
      if (codec !== 'avc') {
        setNote(
          `This browser could not encode H.264, so the file is ${codec.toUpperCase()}. It plays in ` +
            `a browser, but some editors will not import it — use the PNG sequence if yours refuses.`,
        );
      }
    });

  const pct = (tag: string) => (busy?.startsWith(tag) ? busy.split(':')[1] : null);
  // The GIF resolution cap is disclosed on the button rather than applied quietly — same
  // principle as the halftone element cap: a limit you can't see reads as a bug. The label
  // is built in gif.ts so that disclosure is checkable headlessly (see gifButtonLabel).
  const gifLabel = pct('gif') ? `GIF… ${pct('gif')}%` : gifButtonLabel(scene);
  const seqLabel = pct('seq') ? `Frames… ${pct('seq')}%` : 'PNG sequence (.zip)';
  const mp4Label = pct('mp4')
    ? `MP4… ${pct('mp4')}%`
    : scene.background === null
      ? 'MP4 (H.264 · on white)'
      : 'MP4 (H.264)';

  return (
    <Panel title="Export">
      <Readout label="Elements in this frame" value={elements.toLocaleString('en-US')} />
      {/* Disabled while any export runs: they all share one progress slot, and with a
          video source they would also be competing for the same seek queue. */}
      <div className={styles.btnGrid}>
        <Button onClick={exSVG} disabled={busy !== null}>
          SVG · Figma
        </Button>
        <Button onClick={exPNG} disabled={busy !== null}>
          PNG · 2×
        </Button>
      </div>
      <div style={{ marginTop: 6 }}>
        <Button onClick={exJSON} disabled={busy !== null}>
          JSON · coords for AE
        </Button>
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
        <Button onClick={runMP4} disabled={busy !== null || !canMP4}>
          {mp4Label}
        </Button>
        <div style={{ marginTop: 6 }}>
          <Button onClick={runGIF} disabled={busy !== null}>
            {gifLabel}
          </Button>
        </div>
        <div style={{ marginTop: 6 }}>
          <Button onClick={runSeq} disabled={busy !== null}>
            {seqLabel}
          </Button>
        </div>
        {!canMP4 && (
          <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
            {MP4_UNSUPPORTED}
          </p>
        )}
        {note && (
          <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>{note}</p>
        )}
        {error && (
          // whiteSpace: the MP4 failure message is one line per attempted configuration,
          // and collapsing them into a paragraph destroys the only diagnostic we have.
          <p
            style={{
              fontSize: 10.5,
              color: 'var(--accent)',
              lineHeight: 1.5,
              marginTop: 8,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
