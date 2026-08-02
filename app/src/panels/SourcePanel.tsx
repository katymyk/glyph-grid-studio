import { useRef, useState } from 'react';
import { primeImage } from '../engine/imageSample';
import { getMode } from '../engine/modes';
import { isVideoRef, registerVideo, videoInfo } from '../engine/videoSource';
import { SCENE_LAYER, useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { ControlView } from '../ui/controls';
import { srcTimeControl } from './schema';
import styles from '../ui/ui.module.css';

/**
 * The composition's source — a still image or a video clip, one per scene.
 *
 * It is a SCENE panel, not a layer panel: you load the picture once and then stack as
 * many treatments of it as you like, and switching a layer's mode cannot lose it (see
 * `SceneSource`). That is the whole point of the panel sitting up top next to Canvas.
 *
 * An image is stored as a data URL, so it travels with the document. A video is
 * registered out-of-band and stored as a short `video:N` reference: same field, same
 * type, and the modes read through `sampleSource(...)` and never learn the difference.
 * Inlining a clip would put tens of megabytes in the scene, and the scene is cloned onto
 * the undo stack on every edit.
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

export function SourcePanel() {
  const setSource = useStudio((s) => s.setSource);
  const setCanvasSize = useStudio((s) => s.setCanvasSize);
  const setDuration = useStudio((s) => s.setDuration);
  const image = useStudio((s) => s.scene.source.image);
  // Which modes are actually on the canvas right now. A source nothing screens is not an
  // error — you may be about to add the layer — but the panel should not imply it is
  // doing something when no visible layer reads it.
  const usedBy = useStudio((s) => {
    const names = new Set<string>();
    for (const l of s.scene.layers) {
      if (!l.visible) continue;
      if (getMode(l.mode).readsSource) names.add(getMode(l.mode).label);
      if (l.morph && getMode(l.morph.mode).readsSource) names.add(getMode(l.morph.mode).label);
    }
    return [...names].join(', ');
  });

  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  // Tagged with the source it describes: the source can change under us (undo, loading a
  // project), and a filename left over from the last upload would then be naming a
  // picture that is no longer on screen.
  const [status, setStatus] = useState<{ url: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusText = status && status.url === image ? status.text : null;

  const isVideo = isVideoRef(image);
  const clip = isVideo ? videoInfo(image) : null;

  /** Fit the canvas to the source on upload. */
  const fitCanvas = (w: number, h: number) => {
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
        setSource(dataUrl);
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
      const fitted = info.duration > 0 && info.duration <= AUTO_DURATION_CAP;
      if (fitted) setDuration(info.duration);
      setSource(info.ref);
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

  return (
    <Panel title="Source" defaultOpen>
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
        <p style={{ fontSize: 10.5, color: 'var(--accent-fg)', lineHeight: 1.5, marginTop: 8 }}>{error}</p>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
        {image
          ? (statusText ?? (isVideo ? 'Video loaded.' : 'Image loaded.'))
          : 'No source yet. One picture for the whole composition — every layer screens the same frame.'}
      </p>

      {/* Meaningless for a still, so it only appears once there is a clip to move
          through. Rendered through the control registry like any other param, so it
          carries a keyframe diamond and retimes the clip on the scene timeline. */}
      {isVideo && <ControlView layerId={SCENE_LAYER} slot="scene" control={srcTimeControl} />}

      {/* The standing explanation is its own paragraph rather than tacked onto the
          status line, which otherwise runs the filename straight into a sentence. */}
      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 6 }}>
        {isVideo
          ? clip
            ? 'Frames are pulled at the scene frame rate, and the clip holds its last frame past its end. Source time trims the start — keyframe it to retime.'
            : 'This clip is no longer loaded — re-upload it to bring the frames back.'
          : 'The canvas is fitted to the source on upload; if you change the canvas size later, the source is centre-cropped to that aspect.'}
      </p>

      {/* Honest about whether anything is reading it: a photo loaded while every layer is
          generative renders nothing, and silence there looks like a broken upload. */}
      {image && (
        <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 6 }}>
          {usedBy
            ? `Screened by: ${usedBy}.`
            : 'No visible layer reads it yet — set a layer to ASCII or Halftone in Mode.'}
        </p>
      )}
    </Panel>
  );
}
