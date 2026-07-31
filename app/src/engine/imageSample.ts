/**
 * Source sampling. An uploaded image (as a data URL, stored in the layer's `image`
 * param) is decoded once and sampled to a cols×rows luminance+rgb+alpha grid, cached.
 * Tone (contrast/brightness/gamma/threshold) is applied later at draw time by
 * `engine/tone.ts`, never baked in here, so tone sliders never invalidate the cache.
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
const listeners = new Set<() => void>();

/** Register a callback fired when a lazily-decoded source becomes ready (to repaint).
    Returns an unsubscribe — a Set rather than one slot, because more than one
    consumer legitimately wants to know (the store repaints; a panel may show status). */
export function onSampleReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyReady(): void {
  for (const cb of listeners) cb();
}

/** Pre-populate the decoded-image cache (used right after upload to avoid a re-decode). */
export function primeImage(dataUrl: string, img: HTMLImageElement): void {
  imgCache.set(dataUrl, img);
}

/**
 * Cache keys are built on every sample lookup, and a data URL is the whole file in
 * base64 — concatenating megabytes into a key string per frame is not free. Intern
 * each URL to a small integer instead, so the key stays short.
 */
const urlIds = new Map<string, number>();
function urlId(u: string): number {
  let id = urlIds.get(u);
  if (id === undefined) {
    id = urlIds.size + 1;
    urlIds.set(u, id);
  }
  return id;
}

function sampleImage(img: HTMLImageElement, cols: number, rows: number): Sample {
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('no 2d context');
  // A big downscale with the default filter aliases badly, and error diffusion then
  // amplifies that noise into visible worms. 'high' gets us a proper box average.
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
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
    // Rec.709 luma, app-wide. NOTE: `lum` deliberately ignores alpha — getImageData
    // is un-premultiplied, so a transparent pixel is (0,0,0,0) and would read as
    // pure black. Consumers that care must gate on `alpha` themselves.
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
 * decoding (a repaint is triggered via the onSampleReady callbacks when it lands).
 */
export function getSample(dataUrl: string, cols: number, rows: number): Sample | null {
  // Cache first: a hit needs no decoded image at all, which is what lets a caller
  // supply a sample directly (see primeSample).
  const key = `${cols}x${rows}@${urlId(dataUrl)}`;
  const hit = sampleCache.get(key);
  if (hit) return hit;

  const img = imgCache.get(dataUrl);
  if (!img) {
    if (!decoding.has(dataUrl)) {
      decoding.add(dataUrl);
      const im = new Image();
      im.onload = () => {
        imgCache.set(dataUrl, im);
        decoding.delete(dataUrl);
        notifyReady();
      };
      im.onerror = () => decoding.delete(dataUrl);
      im.src = dataUrl;
    }
    return null;
  }
  const s = sampleImage(img, cols, rows);
  sampleCache.set(key, s);
  return s;
}

/**
 * Put an already-computed sample into the cache for (source, cols, rows).
 *
 * The counterpart to `primeImage` one level up: that supplies a decoded image for this
 * module to downscale, this supplies the downscaled result directly. FUTURE (video):
 * frames extracted ahead of the playhead land here, so the modes keep calling
 * `sampleSource` and never learn where the pixels came from.
 */
export function primeSample(source: string, sample: Sample): void {
  sampleCache.set(`${sample.cols}x${sample.rows}@${urlId(source)}`, sample);
}

/**
 * THE sampling entry point for render modes — time-aware.
 *
 * Modes must call this and never `getSample` directly, because this is the seam
 * where video slots in. `frame` is the scene frame index (`round(time * fps)`), not
 * seconds, so a source is asked for a discrete frame and the preview and every
 * exported frame request byte-identical data. A still image ignores `frame`
 * entirely, which is why it costs nothing today.
 *
 * FUTURE (video, next iteration) — what changes and what does not:
 *  - HERE: branch on the source kind. A video ref decodes/seeks to `frame` and
 *    returns null while the seek is in flight, then calls notifyReady() — exactly
 *    the contract images already use, so the modes need no change at all.
 *  - The cache key must gain `frame` (it is already in this function's signature).
 *    Video also needs eviction: `sampleCache` never evicts, which is fine for a
 *    handful of image rungs but is ~4.5 MB per frame at 1024×576. Use a small ring
 *    buffer around the playhead for the video branch, not this Map.
 *  - The one thing outside this file: `export/sequence.ts` and `export/gif.ts` render
 *    frames in a tight synchronous loop, so a not-ready source would silently emit
 *    blank frames. They need to await readiness per frame. Noted in both files.
 */
export function sampleSource(
  image: string | null,
  cols: number,
  rows: number,
  frame: number,
): Sample | null {
  void frame; // still images are frame-independent
  if (!image) return null;
  return getSample(image, cols, rows);
}
