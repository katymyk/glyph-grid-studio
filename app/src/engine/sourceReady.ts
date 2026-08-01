/**
 * Readiness signalling for sources that are not ready the instant they are asked for.
 *
 * Sampling is allowed to fail: an image may still be decoding, a video frame may still
 * be seeking. Two mechanisms live here, and the split matters.
 *
 *  - **Notification.** A source that isn't ready returns null (or a substitute) now and
 *    calls `notifySourceReady()` when the real data lands; the store turns that into a
 *    repaint. The live canvas needs nothing more than this.
 *  - **The probe.** An export cannot repaint-and-hope — it writes each frame to a file
 *    exactly once, so it has to know whether the frame it just rendered was final. A
 *    renderer that had to substitute or skip calls `markSourcePending()`, and an
 *    exporter brackets a render with `beginSourceProbe()` / `sourcePending()` to find
 *    out. That keeps "is this frame final?" answerable without the exporter knowing
 *    anything about grid sizes, frame indices or decode state — which is what lets
 *    `sampleSource` stay the only place in the app that knows video exists.
 *
 * The probe is one global counter, not one per caller: renders are synchronous and
 * never interleave, so the bracket around a single `paintScene` is unambiguous.
 *
 * DOM-free on purpose — it is pure bookkeeping.
 */

/**
 * How exact a render needs its source data to be.
 *
 * `'exact'` — the frame that was asked for, or nothing. Every export, and every paint of a
 * paused canvas.
 * `'live'` — whatever is on screen right now is good enough. Playback only, where a video
 * can be *played* instead of seeked; seeking per frame costs 20–100ms and cannot keep up.
 *
 * It lives here rather than in `videoSource.ts` for the same reason the probe does: this is
 * the module through which "I could not deliver" and "I must have the real thing" talk to
 * each other, and the exporters must not learn that video exists. The probe answers *was
 * this render exact?* after the fact; this declares *must it be?* beforehand.
 */
export type Fidelity = 'exact' | 'live';

let current: Fidelity = 'exact';
const fidelityListeners = new Set<(f: Fidelity) => void>();

export function fidelity(): Fidelity {
  return current;
}

/** Set the regime. Listeners run synchronously, so a caller that latches `'exact'` can
    rely on live playback having stopped by the time this returns. */
export function setFidelity(f: Fidelity): void {
  if (current === f) return;
  current = f;
  for (const cb of [...fidelityListeners]) cb(f);
}

export function onFidelityChange(cb: (f: Fidelity) => void): () => void {
  fidelityListeners.add(cb);
  return () => fidelityListeners.delete(cb);
}

const listeners = new Set<() => void>();

/** Register a callback fired when a lazily-decoded source becomes ready (to repaint).
    Returns an unsubscribe — a Set rather than one slot, because more than one consumer
    legitimately wants to know (the store repaints; an export loop is waiting). */
export function onSourceReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Announce that some source produced new data. */
export function notifySourceReady(): void {
  // Copy first: a one-shot listener (waitForSourceReady) removes itself while we iterate.
  for (const cb of [...listeners]) cb();
}

let pending = 0;

/** Start counting unresolved source requests. Call immediately before a render. */
export function beginSourceProbe(): void {
  pending = 0;
}

/** Record that this render did not get the exact data it asked for. */
export function markSourcePending(): void {
  pending++;
}

/** How many source requests went unresolved since `beginSourceProbe()`. */
export function sourcePending(): number {
  return pending;
}

/**
 * Resolve on the next readiness notification, or `false` on timeout.
 *
 * The timeout is the reason an export can never hang on a source that will never
 * arrive (a corrupt file, a seek the browser drops): the caller gets a definite answer
 * and can finish the job with what it has.
 */
export function waitForSourceReady(timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve(ready);
    };
    const off = onSourceReady(() => finish(true));
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => finish(false), timeoutMs);
  });
}
