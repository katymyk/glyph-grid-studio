/**
 * Reading the source image under the screen.
 *
 * Structurally typed (a `Sample` from imageSample.ts satisfies it) rather than
 * importing that module, so this file stays DOM-free and runs under plain node.
 */
export interface GrayField {
  cols: number;
  rows: number;
  lum: Float32Array;
  rgb: Uint8ClampedArray;
  alpha: Uint8ClampedArray;
}

/**
 * The working resolution the dot screen samples at.
 *
 * Deliberately a function of canvas width ALONE, quantised to a power of two: `cell`
 * and `angle` are the params people animate, and the sample cache is keyed by grid
 * size, so a resolution that tracked `cell` would re-decode and re-downscale the
 * full-res source on most frames of a `cell` keyframe. One grid per (image, canvas
 * size) instead.
 *
 * Half the canvas width gives at least ~2 samples per dot at every cell size the
 * element cap allows, which is all a screen of that pitch can resolve.
 */
export function workingWidth(W: number): number {
  const p = Math.pow(2, Math.round(Math.log2(Math.max(2, W / 2))));
  return Math.max(512, Math.min(2048, p));
}

/** Rows for the working grid. Matches the CANVAS aspect, not the image's — the grid
    is addressed in canvas space, and it also makes halftone crop the same way ASCII
    mode does for the same picture, which matters when layers are stacked or morphed. */
export function workingHeight(W: number, H: number): number {
  return Math.max(1, Math.round(workingWidth(W) * (H / W)));
}

/**
 * Bilinear luminance at normalized canvas coords, weighted by source alpha.
 *
 * Bilinear rather than nearest: at 2–3 samples per dot, point sampling beats the
 * sample grid against the rotated dot lattice and produces a sampling moiré that
 * reads as a rendering fault rather than the intended rosette.
 *
 * ALPHA-WEIGHTED, which is not cosmetic. `lum` comes from un-premultiplied RGB, so a
 * transparent pixel is stored as pure black. Plain bilinear would pull that black
 * across every alpha edge and ring each cut-out with a halo of oversized dark dots —
 * on exactly the transparent-PNG sources this mode is meant to handle. Weighting by
 * alpha means transparent taps contribute nothing instead of contributing black.
 *
 * Edges clamp, so a dot whose centre sits just outside the canvas reads the nearest
 * edge pixel rather than black. A fully transparent neighbourhood returns 1 (paper
 * white → no ink), which the caller's alpha gate then discards anyway.
 */
export function lumAt(s: GrayField, nx: number, ny: number): number {
  const fx = nx * s.cols - 0.5;
  const fy = ny * s.rows - 0.5;
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  const cx = s.cols - 1;
  const cy = s.rows - 1;
  if (x0 < 0) x0 = 0;
  else if (x0 > cx) x0 = cx;
  if (x1 < 0) x1 = 0;
  else if (x1 > cx) x1 = cx;
  if (y0 < 0) y0 = 0;
  else if (y0 > cy) y0 = cy;
  if (y1 < 0) y1 = 0;
  else if (y1 > cy) y1 = cy;

  const i00 = y0 * s.cols + x0;
  const i01 = y0 * s.cols + x1;
  const i10 = y1 * s.cols + x0;
  const i11 = y1 * s.cols + x1;
  // bilinear tap weights, each scaled by that tap's coverage
  const w00 = (1 - tx) * (1 - ty) * s.alpha[i00];
  const w01 = tx * (1 - ty) * s.alpha[i01];
  const w10 = (1 - tx) * ty * s.alpha[i10];
  const w11 = tx * ty * s.alpha[i11];
  const wsum = w00 + w01 + w10 + w11;
  if (wsum <= 0) return 1;
  return (
    (s.lum[i00] * w00 + s.lum[i01] * w01 + s.lum[i10] * w10 + s.lum[i11] * w11) / wsum
  );
}

/** Nearest-sample cell index at normalized canvas coords. */
export function cellAt(s: GrayField, nx: number, ny: number): number {
  const cx = Math.min(s.cols - 1, Math.max(0, Math.floor(nx * s.cols)));
  const cy = Math.min(s.rows - 1, Math.max(0, Math.floor(ny * s.rows)));
  return cy * s.cols + cx;
}

/**
 * Source alpha (0..1). Needed because `lum` is computed from RGB and ignores alpha:
 * canvas pixel data is un-premultiplied, so a transparent PNG's transparent pixels
 * are (0,0,0,0) — pure black — and would halftone into a solid slab of ink exactly
 * where the user expects nothing. Nearest sampling is fine here; it only gates
 * whether a dot exists.
 */
export function alphaAt(s: GrayField, nx: number, ny: number): number {
  return s.alpha[cellAt(s, nx, ny)] / 255;
}

/** Source colour at normalized coords, as a canvas/SVG colour string. */
export function rgbAt(s: GrayField, nx: number, ny: number): string {
  const i = cellAt(s, nx, ny) * 3;
  return `rgb(${s.rgb[i]},${s.rgb[i + 1]},${s.rgb[i + 2]})`;
}
