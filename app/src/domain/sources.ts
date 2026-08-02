/**
 * What `scene.source.image` can hold, as a fact the pure domain owns.
 *
 * A still image is inlined as a data URL. A video is registered out-of-band and
 * referenced by a short id (`video:1`) — see `engine/videoSource.ts` for why.
 *
 * The distinction lives HERE rather than next to the video machinery because saving a
 * project has to reason about it (a data URL travels inside the file; a clip reference
 * cannot) and `domain/` must stay DOM-free so the headless check can run it.
 * `engine/videoSource.ts` re-exports `isVideoRef`, so callers are unaffected.
 */
export const VIDEO_REF_PREFIX = 'video:';

/** Is this source value a video reference rather than an image data URL? */
export function isVideoRef(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith(VIDEO_REF_PREFIX);
}

/** The numeric part of a ref, or 0 if it isn't one. Used to reserve ids after a load so
    a freshly uploaded clip cannot be minted onto a restored project's reference. */
export function videoRefSeq(ref: string): number {
  if (!isVideoRef(ref)) return 0;
  const n = Number(ref.slice(VIDEO_REF_PREFIX.length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
