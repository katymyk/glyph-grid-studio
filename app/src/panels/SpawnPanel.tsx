import { useRef, useState } from 'react';
import { primeImage } from '../engine/imageSample';
import { useStudio, useActiveLayer } from '../state/store';
import { Panel } from '../ui/Panel';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';
import { ControlSlider } from '../ui/ControlSlider';

export function SpawnPanel() {
  const setSpawn = useStudio((s) => s.setSpawn);
  const brushSize = useStudio((s) => s.brushSize);
  const setBrushSize = useStudio((s) => s.setBrushSize);
  const brushErase = useStudio((s) => s.brushErase);
  const setBrushErase = useStudio((s) => s.setBrushErase);
  const maskVisible = useStudio((s) => s.maskVisible);
  const setMaskVisible = useStudio((s) => s.setMaskVisible);
  const layer = useActiveLayer();
  const spawn = layer.spawn;
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastImage, setLastImage] = useState<string | null>(null);

  const setKind = (k: string) => {
    if (k === 'image') {
      setSpawn(layer.id, { kind: 'image', image: spawn.kind === 'image' ? spawn.image : lastImage, invert: false });
    } else if (k === 'brush') {
      setSpawn(layer.id, { kind: 'brush', mask: spawn.kind === 'brush' ? spawn.mask : null, invert: false });
    } else {
      setSpawn(layer.id, { kind: 'full' });
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const url = rd.result as string;
      const img = new Image();
      img.onload = () => {
        primeImage(url, img);
        setLastImage(url);
        setSpawn(layer.id, { kind: 'image', image: url, invert: spawn.kind === 'image' ? spawn.invert : false });
      };
      img.src = url;
    };
    rd.readAsDataURL(f);
    e.target.value = '';
  };

  return (
    <Panel title="Spawn zone">
      <Segmented
        options={[
          { value: 'full', label: 'Full frame' },
          { value: 'image', label: 'Image' },
          { value: 'brush', label: 'Brush' },
        ]}
        value={spawn.kind}
        onChange={setKind}
      />

      {spawn.kind === 'image' && (
        <>
          <div style={{ marginTop: 10 }}>
            <Button onClick={() => fileRef.current?.click()}>Upload mask image</Button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
          <Toggle
            label="Invert mask"
            checked={spawn.invert}
            onChange={(v) => setSpawn(layer.id, { kind: 'image', image: spawn.image, invert: v })}
          />
          <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 6 }}>
            {spawn.image ? 'Mask loaded — bright areas spawn glyphs.' : 'Upload an image. Bright → glyphs, dark → empty.'}
          </p>
        </>
      )}

      {spawn.kind === 'brush' && (
        <>
          <div style={{ marginTop: 10 }}>
            <ControlSlider label="Brush size" value={brushSize} min={10} max={300} onChange={setBrushSize} />
          </div>
          <Segmented
            options={[
              { value: 'draw', label: 'Draw' },
              { value: 'erase', label: 'Erase' },
            ]}
            value={brushErase ? 'erase' : 'draw'}
            onChange={(v) => setBrushErase(v === 'erase')}
          />
          <Toggle label="Show mask overlay" checked={maskVisible} onChange={setMaskVisible} />
          <Toggle
            label="Invert mask"
            checked={spawn.invert}
            onChange={(v) => setSpawn(layer.id, { kind: 'brush', mask: spawn.mask, invert: v })}
          />
          <div style={{ marginTop: 8 }}>
            <Button onClick={() => setSpawn(layer.id, { kind: 'brush', mask: null, invert: spawn.invert })}>
              Clear mask
            </Button>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 6 }}>
            Paint on the canvas — glyphs appear only inside the painted area.
          </p>
        </>
      )}
    </Panel>
  );
}
