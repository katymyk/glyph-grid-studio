# Glyph Grid Studio — Architecture (v2 rewrite)

Status: **proposal, for review.** No code scaffolded yet. This document defines the
structure we'll build against before writing the app.

## 1. Why rewrite

The current tool is a single `index.html` with all HTML/CSS/JS inline. That was the
right call for a one-mode toy. The new goals outgrow it:

- **Timeline animation** — animate any parameter from a start value to an end value
  (and beyond: multiple keyframes, easing).
- **Particle mode** — a third render mode beside generative and ASCII.
- **Mixing modes** — combine modes in one composition (i.e. layers).
- **Flexibility / extensibility** — add modes, params, and export formats without
  rewiring everything.

These need real modules, a typed domain model, and a component UI. Hence the stack
below.

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite** | Fast dev server, simple static build, deploys to GitHub Pages. |
| UI runtime | **React** | Declarative state→UI removes the manual `syncUIFromState` sync (and its bugs). |
| Language | **TypeScript** | Layers, keyframes, easing, blend modes — types keep it navigable and catch the "two functions must agree" class of bug at compile time. |
| Components | **Base UI** (base-ui.com) | Headless/unstyled — we own 100% of the look, which is the point. |
| Styling | **CSS variables (design tokens) + CSS Modules** | Closest to today's `:root` tokens, least ceremony, easy to re-theme. |
| State | **zustand** | Tiny store the render loop can read without forcing React re-renders. |

## 3. The core idea: Scene → Layers → animatable Params

Everything hangs off one model. A **Scene** is an ordered stack of **Layers** on a
timeline; each Layer picks a **mode** and holds **params**; any param can be a constant
or a set of **keyframes** resolved at a time `t`.

```
Scene {
  width, height, fps, duration        // canvas + timeline
  background: Param<Color>
  layers: Layer[]                      // drawn bottom → top
}

Layer {
  id, name, visible
  mode: 'generative' | 'ascii' | 'particle' | …   // registry key
  opacity: Param<number>
  blendMode: GlobalCompositeOperation             // 'source-over', 'multiply', …
  spawn: SpawnZone
  params: Record<string, Param<any>>              // mode-specific
  morph: LayerMorph | null                        // mid-animation mode change (§4a)
}

Param<T> = { kind: 'const'; value: T }
         | { kind: 'keys';  keys: Keyframe<T>[] }

Keyframe<T> = { t, value, easeOut, easeIn, hold? }  // see §4b
```

- **"Start frame → end frame"** = a param with two keyframes.
- **"Mix modes"** = two layers with different `mode`s and a blend mode, *or* one layer
  with a `morph` (§4a) when the same artwork should change form over time.
- **Particle mode** = one more entry in the mode registry (§5). Nothing else changes.

This is the After-Effects-style scene graph; timeline, particles, and mixing all fall
out of it instead of being special-cased.

### 4a. Mode morph — one layer, two modes over time

`Layer.morph` is how a single animation starts as symbols and ends as particles
without hand-animating two layers' opacities:

```
LayerMorph {
  mode, params            // the target mode + its own animatable params
  start, end              // seconds — the handover window
  style: 'fade' | 'dissolve'
  easeOut, easeIn         // the handover curve, same two-half model as a keyframe pair
}
```

`resolveScene` resolves `morphProgress(morph, t)` → `w`, then emits the base mode's
placements with `alpha × (1-w)` and the target's with `alpha × w` (`fade`), or splits
the two sets by a stable per-element hash (`dissolve`, elements swap one at a time).
Both sets land in **one** `ResolvedLayer`, so the layer's spawn zone, opacity and blend
mode apply once — and every exporter gets the morph for free.

### 4b. Easing lives on keyframes, curves live on segments

A keyframe owns two half-curves: `easeOut` (how the value *leaves* it) and `easeIn`
(how the value *arrives* at it). The curve of the span between two keyframes is
composed from the left key's `easeOut` and the right key's `easeIn` — each end owns
half the span — by `segmentProgress()` in `domain/easing.ts`. Ten families
(sine → bounce) plus `hold` (step). This is the only place interpolation shape is
decided, so the timeline preview, the inspector, the canvas and the exports cannot
disagree. `back`/`elastic` overshoot past the keyframe value on purpose.

## 4. Layered architecture (dependency direction points inward)

```
panels/  ──uses──▶  ui/  ──wraps──▶  Base UI
   │                                   
   └────reads/writes────▶  state/  ──holds──▶  domain/ (Scene types)
                                              
canvas/  ──renders──▶  engine/  ──consumes──▶  domain/
export/  ──renders──▶  engine/
```

- **`domain/`** — pure types + math (Scene, Layer, Param, keyframe interpolation,
  easing, blend). No React, no canvas.
- **`engine/`** — framework-free rendering. Given a `Scene` + time `t`, produces pixels
  (canvas) or items (vector/data). This is where today's `makeRNG`, `buildCells`,
  `sampleImage`, `drawScene`, `collectItems`, and the exporters move — ported to TS,
  behavior identical.
- **`state/`** — the zustand store: current Scene, selection, playhead, undo history,
  and actions. The single source of truth. Every param action takes a **slot** —
  `'base'` (the layer's mode params), `'morph'` (the morph target's), or `'layer'`
  (layer-level props like opacity) — so one set of keyframe actions drives all three
  and the timeline never needs special cases.
- **`ui/`** — **the design-system layer** over Base UI (Slider, Segmented, Switch,
  Select, NumberField, ColorField, Panel). Reads design tokens. **Panels import these,
  never Base UI directly** — so re-skinning or swapping a primitive touches only this
  folder. This is your customization seam.
- **`panels/`** — feature panels (Mode, Content, Grid, Canvas, Spawn, Colors, Timeline,
  Export). Compose `ui/` components and dispatch `state/` actions.
- **`canvas/`** — the `<Stage>`: the canvas element, zoom/fit, mask canvas, and the
  requestAnimationFrame loop that calls the engine at the current playhead.

## 5. Render modes are a registry (extensibility)

```ts
interface RenderMode {
  key: string;                          // 'generative'
  label: string;                        // 'Generative'
  defaultParams(): Record<string, Param<any>>;
  // draw one layer's contribution for a resolved param set at time t
  draw(ctx, resolvedParams, cells, ctx2d_helpers): void;
  // extract vector/data items (SVG/JSON) from the same resolved params
  collect(resolvedParams, cells): Item[];
}

registerMode(generativeMode);
registerMode(asciiMode);
// later: registerMode(particleMode);
```

Adding a mode = one new file that implements the interface and registers itself. The
UI reads the registry to populate the mode picker.

## 6. One render path (kills the drift bug)

Today `drawScene` (canvas) and `collectItems` (SVG/JSON) duplicate placement math and
"must agree" by hand — the documented invariant, and a real source of drift. New design:
a single **`resolvePlacements(scene, t)`** computes the placed elements (position, size,
glyph, color, rotation, alpha) once. The canvas renderer paints them; the vector/JSON
exporters serialize the same list. They cannot drift because there's one source.

```
resolvePlacements(scene, t) ─▶ Placement[] ─┬─▶ paintToCanvas()      (live + PNG + GIF + sequence)
                                            └─▶ toSVG() / toJSON()   (vector + data)
```

## 7. Invariants to preserve (carried from v1)

- **Determinism.** All randomness flows through the seeded `makeRNG` (mulberry32).
  Same seed + same params ⇒ identical layout. No `Math.random()` in the render path.
- **Full-res canvas.** The canvas backing store is the Scene's width×height. Zoom is
  CSS-only, so exports stay full resolution.
- **Fonts referenced, never bundled.** ABC Diatype stays a referenced font stack in the
  tokens; no font files committed, no embedded `@font-face`.
- **Render = export.** Per §6, one placement pass feeds both.

## 8. Directory layout

The new app lives in **`app/`** so the current `index.html` at the repo root stays live
and deployable untouched until the rewrite reaches parity.

```
glyph-grid-studio/
  index.html                 # v1 tool — untouched, stays deployed until parity
  ARCHITECTURE.md            # this file
  app/                       # v2 — self-contained Vite project
    index.html               # Vite entry (thin shell: <div id="root">)
    package.json
    vite.config.ts           # base: '/glyph-grid-studio/' for Pages
    tsconfig.json
    public/
    src/
      main.tsx
      App.tsx                 # layout: sidebar (panels) + stage
      domain/
        scene.ts              # Scene, Layer, Item types
        params.ts             # Param<T>, keyframes, resolveParam(param, t)
        easing.ts             # easing functions
      engine/
        rng.ts                # makeRNG
        cells.ts              # buildCells
        sampleGrid.ts         # THE downscale: any drawable → cols×rows lum/rgb/alpha
        imageSample.ts        # sampleSource(): the one seam that knows image vs video
        videoSource.ts        # clip registry, serial seeking, byte-budgeted frame LRU
        sourceReady.ts        # readiness notify + the export "is this frame final?" probe
        placements.ts         # resolvePlacements(scene, t) → Placement[]
        modes/
          index.ts            # registry: registerMode / getMode / listModes
          generative.ts
          ascii.ts
          particle.ts         # (phase 4)
        paint.ts              # paintToCanvas(ctx, placements)
        export/
          frames.ts           # paintSettled / settleSources — no half-decoded frames
          svg.ts  png.ts  json.ts  gif.ts  sequence.ts  mp4.ts
      state/
        store.ts              # zustand: scene, selection, playhead, history, actions
      ui/                     # DESIGN SYSTEM over Base UI (customization seam)
        tokens.css            # CSS variables ported from v1 :root
        Panel.tsx             # Accordion group
        Slider.tsx  Segmented.tsx  Switch.tsx  Select.tsx
        NumberField.tsx  ColorField.tsx
        *.module.css
      panels/
        ModePanel.tsx  schema.ts  CanvasPanel.tsx  SpawnPanel.tsx
        ColorsPanel.tsx  LayersPanel.tsx  ExportPanel.tsx  SeedPanel.tsx
        Timeline.tsx          # the dock: transport + frame ruler + keyframe tracks
        EasingInspector.tsx   # easing editor for the selected keyframe / morph
        paramLabels.ts        # param -> label, derived from schema.ts
      canvas/
        Stage.tsx             # canvas + mask canvas + zoom/fit + rAF loop
  legacy note: v1 index.html is not moved; v2 is promoted to root at parity.
```

## 9. Design tokens & the paper workflow

- Port v1's `:root` custom properties into `app/src/ui/tokens.css` — colors, spacing,
  radius, the ABC Diatype font stacks. Components style against these variables.
- **Workflow:** you sketch layouts/looks on **paper**, share a photo or describe them,
  and we translate the sketch into (a) token values and (b) component structure in
  `ui/`. Because everything reads from `tokens.css`, re-theming is editing one file.
  (No Figma — dropped per your preference.)

## 10. Build & deploy

- Dev: `cd app && npm install && npm run dev`.
- Build: `npm run build` → `app/dist/` (static).
- Pages: while migrating, the existing workflow keeps publishing root `index.html`. At
  parity we point the workflow at `app` (build + publish `app/dist`) and set Vite
  `base: '/glyph-grid-studio/'`. The v1 tool stays reachable until then.

## 11. Migration phases

1. **Foundation** — scaffold `app/` (Vite + React + TS + Base UI); port `engine/` +
   `domain/` as typed modules; render a single hard-coded scene to `<Stage>`. Proves
   the core end-to-end.
2. **Design system** — build `ui/` over Base UI, wired to `tokens.css`.
3. **Parity** — rebuild all v1 panels; match today's feature set (generative + ASCII,
   spawn zones, colors, exports). Ship-switch the deploy.
4. **New powers** — layers + keyframe timeline → particle mode → blend/compose.
5. **Timeline you can see** — the dock (§4b): draggable keyframes with their easing
   curve drawn between them, per-keyframe ease-in/out + presets, hold keys, and the
   mode-morph bar (§4a).

Each phase leaves something that runs.

## 12. Timeline UI notes

- The ruler, every track row and the playhead share one CSS grid
  (`grid-template-columns: var(--gutter) 1fr`), which is what keeps them on the same
  time axis — the playhead is an `inset: 0` overlay using the same grid, not a
  hand-computed offset.
- Time is **displayed in frames** (`round(t × fps)`) because that's the unit the PNG
  sequence and GIF exports emit; the model stays in seconds.
- Drags snap to frames. Dragging a key past a neighbour re-sorts the list, so
  `moveKeyframe` returns the key's new index and the store re-points the selection at
  it — otherwise the drag would jump to whatever key inherited the old index.
- Rows are derived, not stored: any param whose `kind === 'keys'` becomes a row
  (`rowsForLayer`). Labels come from `panels/schema.ts` via `paramLabels.ts`, so the
  timeline and the sidebar can't drift apart.

## 13. Halftone mode, and why `Placement` grew shapes

Halftone is the fourth mode. It screens an uploaded image into marks: `algo` selects
either the rotatable **dot screen** or one of five **threshold** methods
(Floyd–Steinberg, Atkinson, ordered 4×4 / 8×8, random noise).

### 13a. `Placement` is a union now

Every earlier mode drew text, so `Placement` was glyph-only and the painter was one
`fillText`. Halftone draws circles, and the dither algorithms draw boxes. `Placement`
became a two-member union — `GlyphPlacement | ShapePlacement` — for three reasons:

- **Export fidelity.** A dot exported as a `<text>` glyph is a font-dependent
  approximation of a circle. `svg.ts` now emits real `<circle>` / `<rect>` /
  `<polygon>`, which is what makes the Figma hand-off meaningful.
- **Drift becomes a compile error.** Adding a `ShapeKind` that `paint.ts`, `svg.ts` or
  `json.ts` forgot fails to build (`assertNeverShape`). §6 was previously enforced by
  a comment; now the type system holds it.
- **Cost.** A frame can hold >100k dots. A shape placement carries seven fields, not
  twelve plus a meaningless font stack.

Invariants that fell out and must hold: **`(x, y)` is the element's centre for every
shape** (the spawn-zone test, the canvas rotation and the SVG `rotate()` pivot all
assume it), and geometry lives only in `engine/shapes.ts` so painter and exporter
cannot disagree. `paint.ts` batches consecutive same-colour dots into one path, which
collapses a monochrome screen to a single fill.

### 13b. Where the halftone logic lives

```
engine/halftone/
  screen.ts   lattice + site enumeration (tight per-axis bounds), the element cap
  sizeMap.ts  darkness -> dot radius: 'area' | 'coverage' | 'linear'
  dots.ts     the assembled dot screen: sites -> placements
  bayer.ts    generated ordered-dither matrices
  dither.ts   floyd / atkinson / bayer / noise -> a 1-bit grid
  runs.ts     1-bit grid -> run-merged 'pixel' placements
  field.ts    working resolution + alpha-weighted bilinear / colour lookups
engine/tone.ts  brightness / contrast / gamma / threshold / invert (shared with ASCII)
engine/modes/halftone.ts  params, sampling, dispatch — the only browser-side part
```

Verified by `cd app && npm run check` (typecheck + ~150 node assertions on the
DOM-free math + ~85 SSR assertions on the React tree, store, painter and exporters).
See the Testing section of CLAUDE.md.

**Everything under `halftone/` plus `tone.ts` and `rng.ts` is DOM-free and takes plain
typed arrays.** That is a constraint, not a coincidence: it is what lets
`npm run check:math` compile them with `tsc` and exercise them under node. Keep it.

Details that are easy to get wrong and are now locked by assertions:

- **Tone is applied once.** For the dot screen, `threshold` is a smooth offset and
  `invert` flips the luminance mapping. For the threshold algorithms, `threshold` is
  the binary cut and `invert` is a polarity flip on the finished bitmap — so those two
  must be kept *out* of the shaping stage there, or each is applied twice (doubled
  under error diffusion, silently cancelled under an ordered matrix).
- **Per-site randomness is position-keyed** (`hash2D(x, y, seed, stream)`), never drawn
  from `makeRNG`'s stream. The site bounds move with `angle`/`cell` and sites get
  culled, so a stream would reshuffle the whole jitter/grain field as a slider moves.
  Argument order matters: `stream` folds into the seed, so transposing the first three
  makes the y-jitter field the x-jitter field shifted by one row.
- **Transparency is gated at three points**, because it is the case the mode exists to
  handle well and it fails in a different way at each. `Sample.lum` ignores alpha
  (canvas pixel data is un-premultiplied, so a transparent pixel reads as pure black),
  so: the dot builder skips sites whose source alpha is ~0; `lumAt` is **alpha-weighted**
  bilinear, or transparent black bleeds across every cut-out edge and rings it with
  oversized dots; and the dither gate parks transparent cells in a **third bin state**,
  since parking them in "light" turns them into ink the moment `invert` is on.
- **Shapes with a thickness get one.** A ring's `h` is its stroke width, a cross's its
  arm width, a bar's its depth — handing all three `w === h` collapses them into a disc
  and two squares, so `boxFor` applies the `thickness` param rather than letting them
  degenerate.
- **Wide pixel runs are clipped, not point-tested,** against the spawn zone. A merged
  run can span the canvas, so `applySpawn` splits it along mask cells; the walk iterates
  cell *indices*, because deriving the next boundary from the current x does not always
  advance in floating point.
- **Canvas and SVG must composite identically.** The painter batches consecutive
  same-coloured dots into one path, so overlapping dots composite once; the exporter
  therefore hoists a uniform alpha onto the `<g>` instead of putting it on each circle.
  `cross` is one path for the same reason. Neither matters at alpha 1 — both bite the
  moment a layer fades or morphs.

### 13c. Background stays a Scene concern

The mode never paints a background and only ever emits ink. `scene.background === null`
means transparent, and that now works end-to-end for canvas, PNG, SVG and JSON. GIF is
the exception: the format carries no alpha here, so `gif.ts` composites over white and
the button says so.

GIF has a second disclosed limit, for the same reason the element cap has one. gif.js needs
every frame in memory *uncompressed* before it can start encoding — 8.3MB per frame at
1920×1080, ~830MB for four seconds, which is what made the export crawl — and then maps and
packs every one of those pixels. So `GIF_MAX_SIDE` caps the longest side at 720, and the real
output size is printed on the button (`GIF (animated · 720×405)`) rather than applied quietly.
MP4 and the PNG sequence stay full-resolution; a full-HD GIF is a file nobody asked for.

The cap scales the *paint*, not the scene: `scene.width/height` remain the logical space, so
`resolveScene` produces the identical element list and the identical sample-cache keys — same
composition, smaller raster. And `gifButtonLabel` lives in `gif.ts` rather than in the panel
because the Export panel is collapsed by default and a collapsed Collapsible renders no
children under SSR, so a label built in the component could not be asserted headlessly.
Keeping it beside the constant makes "the cap is visible" something the build checks.

### 13d. The element cap

Cell size is a free slider and the canvas can be 8000px, so "cell 3 on a 4K canvas"
asks for ~900k dots per repaint — and the Stage repaints synchronously on every slider
tick. `effectiveCell` / `effectivePixelSize` raise the pitch to hold `maxElements`.
Three properties make it a design rather than a patch: it is **disclosed** (the same
pure function feeds a `readout` control showing the effective pitch and real count),
it is **one cap for preview and export** (a looser export cap would be exactly the
drift §6 exists to prevent), and it is **continuous**, so animating `cell` through the
boundary doesn't snap.

## 14. Video sources

ASCII and Halftone read a **source**, which is either a still image or a video clip. The
modes cannot tell which, and that is the whole design: both ask
`sampleSource(source, cols, rows, frame, fps)` for a cols×rows luminance grid, and every
difference between the two kinds is resolved below that call.

- **A frame index, not a time.** Modes compute `round((time + srcTime) * fps)` and ask for
  that. Quantising at the mode means the preview and every exported frame request the
  same source data, and `srcTime` — an ordinary animatable param — retimes a clip on the
  existing timeline with no timeline code at all.
- **The source is a short ref, not the bytes.** An image is a data URL in the `image`
  param; a video is registered out of band and referenced as `video:1`. Same param, same
  type. Inlining a clip would put tens of megabytes in the scene, and the scene is cloned
  onto the undo stack on every edit.
- **One downscale.** `sampleGrid.ts` owns the cover-fit + Rec.709 read-out for both kinds,
  so a halftone of a PNG and a halftone of frame 40 of an MP4 are screened identically.
  Two copies of that maths is exactly the drift §6 exists to prevent.

### 14a. Not-ready is a normal outcome

Both kinds can fail to answer immediately — an image may be decoding, a video frame may be
seeking — and the difference between the live canvas and an export is what `sourceReady.ts`
exists for.

- The canvas can afford to paint what it has: a not-ready source returns null (image) or
  **the last frame at that grid** (video) and calls `notifySourceReady()` when the real
  data lands, which repaints. Holding the previous frame rather than returning null is
  what keeps a scrub from flickering to empty on every frame.
- An export cannot, because it writes each frame exactly once. So a renderer that had to
  substitute or skip raises `markSourcePending()`, and `export/frames.ts` brackets a paint
  with `beginSourceProbe()` / `sourcePending()` and repaints until nothing is pending.
  **Every animated export goes through `paintSettled`**, so a held frame can never reach a
  file. The exporters stay ignorant of grid sizes, frame indices and decode state — which
  is what lets `sampleSource` remain the only place that knows video exists.
- Both waits are bounded. `waitForSourceReady` times out and `MAX_ROUNDS` caps the retries,
  so a corrupt clip or a dropped seek costs a frame instead of hanging the export.

### 14b. Seeking, and the two caches

- **Seeks are serial and coalesced.** One `HTMLVideoElement` services one seek at a time,
  so requests queue — bounded, and LIFO, because during a scrub the frame under the
  playhead now matters more than the ones it flew past. When the queue drains, a few frames
  ahead of the playhead are read in, which turns playback and a sequence export from a
  seek-per-frame stall into a steady walk.
- **`seeked` is not enough.** It says the seek completed, not that the frame was
  *presented*; drawing on it alone can capture the previous frame. `requestVideoFrameCallback`
  is the real signal, raced against a timer.
- **Two caches, deliberately different.** Still-image samples are cached forever — a
  handful of grid sizes, and the picture never changes. Video frames are ~4.7MB each at
  1024×576, so they get a byte-budgeted LRU keyed by *clip position in milliseconds*, not
  by scene frame. That key is why the held tail of a short clip on a long timeline costs
  one decode rather than one per frame.
- **Past the end the last frame is held**, rather than blanking, so a 3s clip on a 10s comp
  freezes instead of disappearing mid-way.

Determinism narrows here, honestly: same machine + same scene still reproduces exactly
(verified by scrubbing away and back), but byte-identical output *across browsers* is not on
offer for video — decoders differ.

## 15. MP4 export

`export/mp4.ts` renders the loop and encodes it with WebCodecs, muxing MP4 in the browser.

- **Not `MediaRecorder`.** That records in realtime, so the file's timing is whatever the
  machine managed while rendering — and a halftone frame can take 200ms. WebCodecs encodes
  frame by frame at whatever pace the render takes, so the output is exactly
  `fps × duration` frames long.
- **The muxer is dynamically imported.** It is the largest dependency in the app and only
  this button needs it, so the cost lands on the click, not on first paint (it builds as its
  own chunk).
- **Even dimensions.** H.264 rejects an odd width or height, so the encode canvas rounds
  *up* to even and the paint is scaled to fit — cropping would drop a column, padding would
  leave a seam.
- **No alpha.** Like GIF, a transparent scene is composited over white and the button says
  so.
- **Honest degradation.** `mp4Supported()` is a synchronous check that disables the button
  without loading the encoder, and codecs are tried in order (`avc` first — it is what
  After Effects and Premiere want) with a readable message if none work.

### 15a. Negotiate, don't interrogate

The first version asked `getFirstEncodableVideoCodec` whether a codec was usable, then
encoded with a *differently shaped* config. That cost us Safari outright, and the failure is
worth remembering because the shape of it recurs:

- A qualitative `QUALITY_HIGH` makes mediabunny prefer quantizer-based rate control, which
  puts `bitrateMode: 'quantizer'` — an enum member only Chromium has — into the config.
- A browser whose IDL lacks that member **throws** during dictionary conversion, so
  `VideoEncoder.isConfigSupported` *rejects* rather than answering "unsupported", and
  mediabunny's own fallback only walks across a resolved `false`.
- The rejection propagated out of the capability probe and killed the export before a
  single frame was painted. Worse, the rejected promise is memoised, so every later click
  in that page session failed identically.

Two rules came out of it. **A capability probe that asks a different question than the real
call is a second source of truth, and the two will disagree** — so `MP4_ATTEMPTS` is now
walked by actually encoding frame 0, and "can this browser do it" and "did this browser do
it" are the same event. And **`preferBitrate` is load-bearing**, not a tuning knob: it keeps
the problematic enum out of the config entirely.

The retry is cheap because of one fact worth stating: `configure()` happens inside the first
`source.add()`, not in `output.start()` (`CanvasSource` has no `_start` of its own). Frame 0
is painted once before the ladder, `add` copies the canvas rather than consuming it, and a
rejected rung costs a muxer header — so the ladder never re-renders the animation. An encoder
error that surfaces later, on frame 1+, is reported rather than retried: a different codec is
unlikely to fix it and re-rendering to find out is not worth it.

Because none of this can be tested here (no Safari automation), the diagnostics carry the
weight: every rung logs, and the thrown message names each attempted config and the browser's
own `error.name` — `TypeError` (an IDL member was rejected) vs `NotSupportedError` (the
browser understood and said no) vs `EncodingError` (the encoder died) are three different
bugs that otherwise read identically.
