import { useRef, useState } from 'react';
import { resolveParam, type Param } from '../domain/params';
import { primeImage } from '../engine/imageSample';
import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';

/** Bespoke: upload an image (stored as a data URL param) and fit the canvas to it. */
export function AsciiImagePanel() {
  const setConstParam = useStudio((s) => s.setConstParam);
  const setCanvasSize = useStudio((s) => s.setCanvasSize);
  const layer = useActiveLayer();
  const image = resolveParam(layer.params.image as Param<string | null>, 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        primeImage(dataUrl, img); // warm the cache so the first paint samples synchronously
        const long = Math.max(img.width, img.height);
        const scale = long > 2400 ? 2400 / long : long < 600 ? 600 / long : 1;
        setCanvasSize(Math.max(100, Math.round(img.width * scale)), Math.max(100, Math.round(img.height * scale)));
        setConstParam(layer.id, 'image', dataUrl);
        setStatus(`${f.name} · ${img.width}×${img.height}`);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  return (
    <Panel title="Image" defaultOpen>
      <Button onClick={() => fileRef.current?.click()}>Upload image</Button>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
        {image ? (status ?? 'Image loaded.') : 'No image yet. Dark areas → dense chars, bright → sparse. Canvas fits the image on upload.'}
      </p>
    </Panel>
  );
}
