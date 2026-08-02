/**
 * THE downscale. Every source kind — a decoded still image, a seeked video frame —
 * becomes a cols×rows luminance+rgb+alpha grid through this one function.
 *
 * That is deliberate rather than tidy: an ASCII portrait and a halftone of the same
 * picture must read identically whether the pixels came from a PNG or from frame 40 of
 * an MP4, and a second copy of the cover-fit maths is exactly the drift the
 * one-render-path rule exists to prevent. Everything above this line differs between
 * the source kinds (caching, decode, seeking); everything below it must not.
 */
import { coverCrop } from './cover';

export interface Sample {
  cols: number;
  rows: number;
  lum: Float32Array;
  rgb: Uint8ClampedArray;
  alpha: Uint8ClampedArray;
}

/**
 * The grid a sample is taken on — resolution AND the shape of the space it covers.
 *
 * `cols`/`rows` size the buffer. `aspect` is the width/height of the **canvas region**
 * that buffer is stretched across, and it is a separate fact on purpose: a mode samples at
 * whatever resolution suits it (ASCII takes one cell per character, the dot screen uses a
 * fixed working grid), so `cols/rows` is NOT the shape of the thing on screen.
 *
 * Conflating the two is a silent bug. Cropping against `cols/rows` looks right for as long
 * as the two happen to agree — ASCII's 80×45 default is exactly 16:9 — and then stretches
 * every picture on any other canvas. Keep them separate and each caller has to say which
 * space it is addressing.
 */
export interface SampleGrid {
  cols: number;
  rows: number;
  aspect: number;
}

/** A `cols`×`rows` buffer covering a whole W×H canvas. The only shape any mode needs. */
export function gridFor(cols: number, rows: number, W: number, H: number): SampleGrid {
  return { cols, rows, aspect: H > 0 ? W / H : 1 };
}

/** Cache-key fragment for a grid. Shared by the image and video caches so a change of
    canvas shape invalidates both — the pixels genuinely differ. */
export function gridId(g: SampleGrid): string {
  return `${g.cols}x${g.rows}:${g.aspect.toFixed(4)}`;
}

/** Float32 luminance + 3×u8 rgb + u8 alpha. Used to budget the video frame cache. */
export const SAMPLE_BYTES_PER_CELL = 8;

export function sampleBytes(s: Sample): number {
  return s.cols * s.rows * SAMPLE_BYTES_PER_CELL;
}

/**
 * One scratch canvas, reused. A video source asks for a fresh sample every frame, and
 * allocating (then GC-ing) a canvas per frame is a real cost at 25fps. Safe to share
 * because sampling is synchronous — no two samples are ever in flight at once.
 */
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function scratchFor(cols: number, rows: number): CanvasRenderingContext2D {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  }
  if (!scratchCtx) throw new Error('no 2d context');
  if (scratch.width !== cols) scratch.width = cols;
  if (scratch.height !== rows) scratch.height = rows;
  // A big downscale with the default filter aliases badly, and error diffusion then
  // amplifies that noise into visible worms. 'high' gets us a proper box average.
  // (Set after any resize: resizing a canvas resets its context state.)
  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.imageSmoothingQuality = 'high';
  scratchCtx.clearRect(0, 0, cols, rows);
  return scratchCtx;
}

/**
 * Cover-fit `src` (whose intrinsic size is srcW×srcH) into `grid` and read out per-cell
 * luminance, colour and alpha.
 *
 * `srcW`/`srcH` are passed in rather than read off the drawable because the property
 * that carries them differs by kind — `width` on an image, `videoWidth` on a video —
 * and a video reports 0 until it has decoded something.
 *
 * The crop is taken against `grid.aspect` — the shape of the canvas the samples will be
 * drawn across — NOT against `cols/rows`. Those differ whenever a mode samples at a
 * resolution that isn't the canvas's shape, and using the buffer's own aspect there both
 * crops the wrong window out of the source and stretches what survives.
 */
export function sampleDrawable(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  grid: SampleGrid,
): Sample {
  if (srcW <= 0 || srcH <= 0) throw new Error('source has no intrinsic size yet');
  const { cols, rows } = grid;
  const octx = scratchFor(cols, rows);

  // Cover-fit to the CANVAS shape, then squeeze that rectangle into the buffer. The
  // squeeze is deliberate and harmless: the buffer is stretched back over a region of
  // exactly `grid.aspect`, so the two cancel.
  const { sx, sy, sw, sh } = coverCrop(srcW, srcH, grid.aspect);
  octx.drawImage(src, sx, sy, sw, sh, 0, 0, cols, rows);
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
