/**
 * Source sampling — the front door for every mode that reads pixels.
 *
 * A still image (a data URL in the layer's `image` param) is decoded once and sampled
 * to a cols×rows luminance+rgb+alpha grid, cached forever: there are only a handful of
 * grid sizes and the picture never changes. A video (`video:1`, see `videoSource.ts`)
 * needs decode-on-demand and eviction, so it lives next door and is reached through the
 * one branch in `sampleSource` below.
 *
 * Tone (contrast/brightness/gamma/threshold) is applied later at draw time by
 * `engine/tone.ts`, never baked in here, so tone sliders never invalidate the cache.
 */
import { markSourcePending, notifySourceReady } from './sourceReady';
import { sampleDrawable, type Sample } from './sampleGrid';
import { isVideoRef, sampleVideoFrame } from './videoSource';

export type { Sample } from './sampleGrid';

const imgCache = new Map<string, HTMLImageElement>();
const sampleCache = new Map<string, Sample>();
const decoding = new Set<string>();

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

/**
 * Get the sample for (image, cols, rows). Returns null while the image is still
 * decoding (a repaint is triggered via the onSourceReady callbacks when it lands).
 */
export function getSample(dataUrl: string, cols: number, rows: number): Sample | null {
  // Cache first: a hit needs no decoded image at all, which is what lets a caller
  // supply a sample directly (see primeSample).
  const key = `${cols}x${rows}@${urlId(dataUrl)}`;
  const hit = sampleCache.get(key);
  if (hit) return hit;

  const img = imgCache.get(dataUrl);
  if (!img) {
    markSourcePending(); // an export must wait for this rather than write a blank frame
    if (!decoding.has(dataUrl)) {
      decoding.add(dataUrl);
      const im = new Image();
      im.onload = () => {
        imgCache.set(dataUrl, im);
        decoding.delete(dataUrl);
        notifySourceReady();
      };
      im.onerror = () => decoding.delete(dataUrl);
      im.src = dataUrl;
    }
    return null;
  }
  const s = sampleDrawable(img, img.width, img.height, cols, rows);
  sampleCache.set(key, s);
  return s;
}

/**
 * Put an already-computed sample into the cache for (source, cols, rows).
 *
 * The counterpart to `primeImage` one level up: that supplies a decoded image for this
 * module to downscale, this supplies the downscaled result directly.
 */
export function primeSample(source: string, sample: Sample): void {
  sampleCache.set(`${sample.cols}x${sample.rows}@${urlId(source)}`, sample);
}

/**
 * THE sampling entry point for render modes — time-aware, source-kind-agnostic.
 *
 * Modes must call this and never `getSample` directly: this is the only place in the
 * app that knows a source can be a video. `frame` is the scene frame index
 * (`round((time + srcTime) * fps)`), not seconds, so a source is asked for a discrete
 * frame and the preview and every exported frame request identical data. `fps` comes
 * along because the video branch has to turn that index back into a clip position.
 *
 * A still image ignores both, which is why it costs nothing.
 *
 * Not-ready is a normal outcome, for either kind. The contract:
 *  - return null (image) or the last frame at this grid (video) *now*;
 *  - raise `markSourcePending()`, so an export knows the frame isn't final;
 *  - call `notifySourceReady()` when the real data lands, which repaints.
 * Modes just check for null and return no placements — they never see the difference.
 */
export function sampleSource(
  source: string | null,
  cols: number,
  rows: number,
  frame: number,
  fps: number,
): Sample | null {
  if (!source) return null;
  if (isVideoRef(source)) return sampleVideoFrame(source, cols, rows, frame, fps);
  return getSample(source, cols, rows);
}
