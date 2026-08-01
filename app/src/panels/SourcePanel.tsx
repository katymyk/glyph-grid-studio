import { useRef, useState } from 'react';
import { resolveParam, type Param } from '../domain/params';
import { primeImage } from '../engine/imageSample';
import { isVideoRef, registerVideo, videoInfo } from '../engine/videoSource';
import { readParam, useStudio, useActiveLayer, type Slot } from '../state/store';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import styles from '../ui/ui.module.css';

/**
 * The source for any mode that reads pixels (ASCII, Halftone) — a still image or a
 * video clip.
 *
 * An image is stored as a data URL in the layer's `image` param, so it travels with the
 * document. A video is registered out-of-band and stored as a short `video:N` reference
 * in that same param: same param, same type, no change to the modes, which read through
 * `sampleSource(image, cols, rows, frame, fps)` and never learn the difference. Inlining
 * a clip would put tens of megabytes in the scene, and the scene is cloned onto the undo
 * stack on every edit.
 */

/**
 * How much of a long clip the timeline is set to on upload.
 *
 * Fitting the timeline to the clip is the useful default, but a two-minute file would
 * give a timeline nothing can be read on and a GIF export of three thousand frames. Past
 * this the duration is left alone and the panel says what it did, rather than quietly
 * choosing either extreme.
 */
const AUTO_DURATION_CAP = 30;

export function SourcePanel({ slot = 'base' }: { slot?: Slot }) {
  const setConstParam = useStudio((s) => s.setConstParam);
  const setCanvasSize = useStudio((s) => s.setCanvasSize);
  const setDuration = useStudio((s) => s.setDuration);
  const layer = useActiveLayer();
  const mode = slot === 'morph' ? (layer.morph?.mode ?? layer.mode) : layer.mode;
  const param = readParam(layer, slot, 'image') as Param<string | null> | undefined;
  const image = param ? resolveParam(param, 0) : null;
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  // Tagged with the source it describes: the image param can change under us (undo,
  // a mode switch, loading a project), and a filename left over from the last upload
  // would then be naming a picture that is no longer on screen.
  const [status, setStatus] = useState<{ url: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusText = status && status.url === image ? status.text : null;

  const isVideo = isVideoRef(image);
  const clip = isVideo ? videoInfo(image) : null;

  /** Fit the canvas to the source. Only the base layer does this — a morph target
      resizing the scene would move the artwork the base mode already laid out. */
  const fitCanvas = (w: number, h: number) => {
    if (slot !== 'base') return;
    const long = Math.max(w, h);
    const scale = long > 2400 ? 2400 / long : long < 600 ? 600 / long : 1;
    setCanvasSize(Math.max(100, Math.round(w * scale)), Math.max(100, Math.round(h * scale)));
  };

  const onImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        primeImage(dataUrl, img); // warm the cache so the first paint samples synchronously
        fitCanvas(img.width, img.height);
        setConstParam(layer.id, 'image', dataUrl, slot);
        setStatus({ url: dataUrl, text: `${f.name} · ${img.width}×${img.height}` });
      };
      img.onerror = () => setError(`Could not read ${f.name} as an image.`);
      img.src = dataUrl;
    };
    reader.onerror = () => setError(`Could not read ${f.name}.`);
    reader.readAsDataURL(f);
  };

  const onVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const info = await registerVideo(f);
      fitCanvas(info.width, info.height);
      // Fit the timeline to the clip, so the whole thing plays without touching Duration.
      const fitted = slot === 'base' && info.duration > 0 && info.duration <= AUTO_DURATION_CAP;
      if (fitted) setDuration(info.duration);
      setConstParam(layer.id, 'image', info.ref, slot);
      const len = info.duration > 0 ? `${info.duration.toFixed(1)}s` : 'unknown length';
      setStatus({
        url: info.ref,
        text:
          `${info.name} · ${info.width}×${info.height} · ${len}` +
          (!fitted && info.duration > AUTO_DURATION_CAP
            ? ` — longer than ${AUTO_DURATION_CAP}s, so the timeline was left as it is. Raise Duration in Canvas to use more of it.`
            : ''),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that video.');
    } finally {
      setBusy(false);
    }
  };

  const empty =
    mode === 'halftone'
      ? 'No source yet. Dark areas grow the dots, bright areas shrink them.'
      : 'No source yet. Dark areas → dense chars, bright → sparse.';

  return (
    <Panel title={slot === 'morph' ? '→ Source' : 'Source'} defaultOpen>
      <div className={styles.btnGrid}>
        <Button onClick={() => imageRef.current?.click()} disabled={busy}>
          Image
        </Button>
        <Button onClick={() => videoRef.current?.click()} disabled={busy}>
          {busy ? 'Loading…' : 'Video'}
        </Button>
      </div>
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onImageFile}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={onVideoFile}
      />

      {error && (
        <p style={{ fontSize: 10.5, color: 'var(--accent)', lineHeight: 1.5, marginTop: 8 }}>{error}</p>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
        {image ? (statusText ?? (isVideo ? 'Video loaded.' : 'Image loaded.')) : empty}
      </p>

      {/* The standing explanation is its own paragraph rather than tacked onto the
          status line, which otherwise runs the filename straight into a sentence. */}
      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 6 }}>
        {isVideo
          ? clip
            ? 'Frames are pulled at the scene frame rate, and the clip holds its last frame past its end. Use Clip → Source time to trim the start, or keyframe it to retime.'
            : 'This clip is no longer loaded — re-upload it to bring the frames back.'
          : slot === 'base'
            ? 'The canvas is fitted to the source on upload; if you change the canvas size later, the source is centre-cropped to that aspect.'
            : ''}
      </p>
    </Panel>
  );
}
