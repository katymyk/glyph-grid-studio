/**
 * Image sampling for ASCII mode. An uploaded image (as a data URL, stored in the
 * layer's `image` param) is decoded once and sampled to a cols×rows luminance+rgb
 * grid, cached. Contrast/brightness are applied later at draw time, not baked in.
 */
export interface Sample {
  cols: number;
  rows: number;
  lum: Float32Array;
  rgb: Uint8ClampedArray;
  alpha: Uint8ClampedArray;
}

const imgCache = new Map<string, HTMLImageElement>();
const sampleCache = new Map<string, Sample>();
const decoding = new Set<string>();
let notify: (() => void) | null = null;

/** Register a callback fired when a lazily-decoded image becomes ready (to repaint). */
export function onSampleReady(cb: () => void): void {
  notify = cb;
}

/** Pre-populate the decoded-image cache (used right after upload to avoid a re-decode). */
export function primeImage(dataUrl: string, img: HTMLImageElement): void {
  imgCache.set(dataUrl, img);
}

export function imageAspect(dataUrl: string): number | null {
  const img = imgCache.get(dataUrl);
  return img ? img.width / img.height : null;
}

function sampleImage(img: HTMLImageElement, cols: number, rows: number): Sample {
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('no 2d context');
  // cover-fit the image into cols×rows
  const ir = img.width / img.height;
  const gr = cols / rows;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > gr) {
    sh = img.height;
    sw = sh * gr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / gr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
  const data = octx.getImageData(0, 0, cols, rows).data;
  const lum = new Float32Array(cols * rows);
  const rgb = new Uint8ClampedArray(cols * rows * 3);
  const alpha = new Uint8ClampedArray(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const R = data[i * 4];
    const G = data[i * 4 + 1];
    const B = data[i * 4 + 2];
    lum[i] = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    rgb[i * 3] = R;
    rgb[i * 3 + 1] = G;
    rgb[i * 3 + 2] = B;
    alpha[i] = data[i * 4 + 3];
  }
  return { cols, rows, lum, rgb, alpha };
}

/**
 * Get the sample for (image, cols, rows). Returns null while the image is still
 * decoding (a repaint is triggered via the onSampleReady callback when it lands).
 */
export function getSample(dataUrl: string, cols: number, rows: number): Sample | null {
  const img = imgCache.get(dataUrl);
  if (!img) {
    if (!decoding.has(dataUrl)) {
      decoding.add(dataUrl);
      const im = new Image();
      im.onload = () => {
        imgCache.set(dataUrl, im);
        decoding.delete(dataUrl);
        notify?.();
      };
      im.onerror = () => decoding.delete(dataUrl);
      im.src = dataUrl;
    }
    return null;
  }
  const key = `${cols}x${rows}@${dataUrl}`;
  let s = sampleCache.get(key);
  if (!s) {
    s = sampleImage(img, cols, rows);
    sampleCache.set(key, s);
  }
  return s;
}
