/**
 * The cover-fit crop: which rectangle of a source fills a target of a given aspect.
 *
 * Split out of `sampleGrid.ts` (which needs a canvas, and so cannot be checked without a
 * browser) because this is the whole of the geometry and it failed silently for months:
 * cropping against the sample buffer's own `cols/rows` looks correct for exactly as long
 * as the buffer's shape happens to match the canvas's — ASCII's 80×45 default is 16:9 to
 * the digit — and stretches the picture on every other canvas.
 *
 * The invariant, and the reason this is a named function with tests rather than six lines
 * inline: **the returned rectangle's aspect IS `aspect`.** Squeeze that rectangle into any
 * buffer, stretch the buffer back over a region of that aspect, and the picture comes out
 * the shape it went in. That is the only property that matters, and it is checkable.
 *
 * DOM-free on purpose (`npm run check:math`).
 */

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The largest centred rectangle of `aspect` (width / height) that fits inside a
 * `srcW`×`srcH` source. Cover, not contain: the crop fills the target completely and
 * loses the overhanging strip, rather than fitting inside it and leaving bars.
 */
export function coverCrop(srcW: number, srcH: number, aspect: number): CropRect {
  // A degenerate aspect would produce NaN geometry and a blank frame with no error, so
  // fall back to the source's own shape — i.e. no crop at all.
  const target = Number.isFinite(aspect) && aspect > 0 ? aspect : srcW / srcH;
  if (srcW / srcH > target) {
    // source is wider than the target: keep full height, trim the sides
    const sw = srcH * target;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / target;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}
