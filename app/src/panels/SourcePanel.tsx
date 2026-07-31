import { useRef, useState } from 'react';
import { resolveParam, type Param } from '../domain/params';
import { primeImage } from '../engine/imageSample';
import { readParam, useStudio, useActiveLayer, type Slot } from '../state/store';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';

/**
 * The source image for any mode that reads one (ASCII, Halftone). Stored as a data
 * URL in the layer's `image` param, so it travels with the document.
 *
 * FUTURE (video): this is the ingest point. A video would be registered out-of-band
 * and referenced by a short id string in this same param — no param type change, and
 * no change to the modes, which read through `sampleSource(image, cols, rows, frame)`.
 */
export function SourcePanel({ slot = 'base' }: { slot?: Slot }) {
  const setConstParam = useStudio((s) => s.setConstParam);
  const setCanvasSize = useStudio((s) => s.setCanvasSize);
  const layer = useActiveLayer();
  const mode = slot === 'morph' ? (layer.morph?.mode ?? layer.mode) : layer.mode;
  const param = readParam(layer, slot, 'image') as Param<string | null> | undefined;
  const image = param ? resolveParam(param, 0) : null;
  const fileRef = useRef<HTMLInputElement>(null);
  // Tagged with the data URL it describes: the image param can change under us (undo,
  // a mode switch, loading a project), and a filename left over from the last upload
  // would then be naming a picture that is no longer on screen.
  const [status, setStatus] = useState<{ url: string; text: string } | null>(null);
  const statusText = status && status.url === image ? status.text : null;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        primeImage(dataUrl, img); // warm the cache so the first paint samples synchronously
        // Only the base layer's upload sets the canvas size. A morph target doing it
        // would resize the scene under the artwork the base mode already laid out.
        if (slot === 'base') {
          const long = Math.max(img.width, img.height);
          const scale = long > 2400 ? 2400 / long : long < 600 ? 600 / long : 1;
          setCanvasSize(
            Math.max(100, Math.round(img.width * scale)),
            Math.max(100, Math.round(img.height * scale)),
          );
        }
        setConstParam(layer.id, 'image', dataUrl, slot);
        setStatus({ url: dataUrl, text: `${f.name} · ${img.width}×${img.height}` });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  const empty =
    mode === 'halftone'
      ? 'No image yet. Dark areas grow the dots, bright areas shrink them.'
      : 'No image yet. Dark areas → dense chars, bright → sparse.';

  return (
    <Panel title={slot === 'morph' ? '→ Source' : 'Source'} defaultOpen>
      <Button onClick={() => fileRef.current?.click()}>Upload image</Button>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
        {image ? (statusText ?? 'Image loaded.') : empty}
        {slot === 'base' ? ' The canvas is fitted to the image on upload; if you change the canvas size later, the image is centre-cropped to that aspect.' : ''}
      </p>
    </Panel>
  );
}
