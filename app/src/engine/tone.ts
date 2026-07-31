/**
 * Tone mapping — pure functions on a 0..1 luminance. No canvas, no DOM, no RNG,
 * so it is directly runnable in node (see the verification recipe in CLAUDE.md).
 *
 * This is the single definition of what "brightness / contrast / gamma / threshold /
 * invert" mean in this app. ASCII mode and halftone mode both call it, so the two
 * cannot drift apart — a picture adjusted for one mode looks the same in the other.
 *
 * Unit conventions (kept identical to the existing ASCII sliders):
 *   contrast   20..300  (%)    100 = identity, gain about mid-grey
 *   brightness -100..100       0   = identity, added after contrast
 *   gamma      20..300  (%)    100 = identity, >100 lifts midtones
 *   threshold  -100..100       0   = identity, >0 = darker (more ink)
 *   invert     boolean         applied last
 */
export interface ToneOpts {
  contrast?: number;
  brightness?: number;
  gamma?: number;
  threshold?: number;
  invert?: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Luminance in → luminance out (0 = black, 1 = white).
 *
 * Order matters and is fixed: contrast about mid-grey, then brightness, then clamp,
 * then gamma, then the threshold shift, then invert. With gamma=100 and threshold=0
 * this is exactly the expression ASCII mode used before it called in here.
 */
export function mapTone(lum: number, o: ToneOpts): number {
  const k = (o.contrast ?? 100) / 100;
  let v = (lum - 0.5) * k + 0.5; // 1. contrast about mid-grey
  v += (o.brightness ?? 0) / 100; // 2. brightness offset
  v = clamp01(v); // 3. clamp before pow — pow of a negative is NaN
  const g = o.gamma ?? 100;
  if (g !== 100) v = Math.pow(v, 100 / g); // 4. gamma (>100 brightens midtones)
  v -= (o.threshold ?? 0) / 200; // 5. threshold moves where mid-grey sits
  v = clamp01(v);
  return o.invert ? 1 - v : v; // 6. invert last
}

/** Ink demand 0..1 — how much this luminance should be covered. The halftone dot
    area and the ASCII ramp index are both driven by this. */
export function inkFromLum(lum: number, o: ToneOpts): number {
  return 1 - mapTone(lum, o);
}

/**
 * The binary cut for the dither algorithms, in the same 0..1 domain. Kept separate
 * from `mapTone`'s threshold step because error diffusion needs the cut as a level to
 * compare against, not as an offset baked into the signal.
 *
 * Sign: `mapTone` implements threshold as `v -= threshold/200`, and
 * `v - threshold/200 < 0.5` is the same test as `v < 0.5 + threshold/200`. So the cut
 * moves UP with threshold, which is what makes a positive threshold mean more ink in
 * both the dot screen and the threshold algorithms.
 */
export function inkThreshold(o: ToneOpts): number {
  return 0.5 + (o.threshold ?? 0) / 200;
}
