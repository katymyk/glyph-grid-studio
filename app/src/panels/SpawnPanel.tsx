import { useRef, useState } from 'react';
import { primeImage } from '../engine/imageSample';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';

/** Bespoke: restrict where a layer's glyphs appear — full frame or an image mask
    (bright areas spawn). Reuses the image-sampling infra. */
export function SpawnPanel() {
  const scene = useStudio((s) => s.scene);
  const setSpawn = useStudio((s) => s.setSpawn);
  const layer = scene.layers[0];
  const spawn = layer.spawn;
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastImage, setLastImage] = useState<string | null>(null);

  const setKind = (k: string) => {
    if (k === 'image') {
      const image = spawn.kind === 'image' ? spawn.image : lastImage;
      const invert = spawn.kind === 'image' ? spawn.invert : false;
      setSpawn(layer.id, { kind: 'image', image, invert });
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
          { value: 'image', label: 'Image mask' },
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
            {spawn.image
              ? 'Mask loaded — bright areas spawn glyphs, dark areas stay empty.'
              : 'Upload an image. Bright → glyphs, dark → empty.'}
          </p>
        </>
      )}
    </Panel>
  );
}
