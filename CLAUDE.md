# CLAUDE.md

Guidance for Claude Code (and any AI assistant) working in this repository.

## What this is

Glyph Grid Studio — a single-file, client-side web tool for generating typographic
and ASCII visuals on a fixed 1920×1080 canvas, with export to SVG (Figma), PNG,
JSON, and PNG image sequences (After Effects). No backend, no build step.

## Project structure

- `index.html` — **the entire application.** HTML, CSS, and JavaScript in one file.
  This is intentional: it keeps the tool portable (open it anywhere, works offline)
  and deployable as a static page with zero configuration.
- `README.md` — user-facing description and setup.
- `CLAUDE.md` — this file.
- `.github/workflows/deploy.yml` — auto-publishes `index.html` to GitHub Pages on push to `main`.

There is **no package.json and no build tooling.** Do not add a bundler, framework,
or transpiler unless explicitly asked — it would break the "open the file and it runs"
guarantee that is the point of this project.

## How the code is organized (inside index.html)

Read top to bottom; it's ordered deliberately.

1. `<style>` — all CSS. Uses CSS custom properties in `:root`. The `--diatype` and
   `--diamono` variables define the font stacks (ABC Diatype → fallbacks).
2. Sidebar markup — the control panel, grouped in `<details>` sections
   (Mode, Content, Grid, Spawn zone, Colors, Animation, Export, Randomness).
3. `<script>` — the logic, in this order:
   - Constants: `W`/`H` (1920×1080), `FONT_STACKS`, `DEFAULTS`, `state`.
   - `makeRNG(seed)` — deterministic mulberry32 PRNG. **All randomness flows through
     this seeded generator** so a given seed always reproduces the same layout.
   - `buildCells()` — precomputes one record per grid cell with stable random values.
   - `sampleImage()` — for ASCII mode: downscales the uploaded image to cols×rows and
     stores per-cell luminance + RGB.
   - `inZone(cx,cy)` — spawn-zone test (full / ellipse / brush mask).
   - `drawScene(ctx, tSec, guide)` — **the single source of truth for rendering.**
     Used by both the live canvas loop and the export paths. If you change how a glyph
     is placed, colored, or animated, change it here and everywhere stays consistent.
   - UI bindings — each control mutates `state`, then calls `draw()` or `rebuild()`.
   - History (`snapshot`/`undo`), Reset, Surprise me.
   - Export handlers (SVG / PNG / JSON / sequence / save-load project).
   - `syncUIFromState()` — pushes `state` back into every control (used after undo,
     reset, surprise, and project load).

## Key invariants — keep these true

- **`drawScene` and `collectItems` must agree.** `drawScene` renders to canvas;
  `collectItems` produces the element list for SVG/JSON export. They share the same
  placement math. If they drift, exports won't match the preview.
- **Determinism.** Same `state.seed` + same settings ⇒ identical layout. Don't
  introduce `Math.random()` into the rendering path; use the seeded RNG in `buildCells`.
- **`rebuild()` vs `draw()`.** Call `rebuild()` when the cell set changes
  (cols, rows, seed, or a new image). Call `draw()` for everything else (colors,
  size, jitter, animation params). `rebuild()` is heavier — it regenerates cells.
- **Canvas is always 1920×1080.** Zoom is CSS-only (`applyZoom`); the backing canvas
  never changes resolution, so exports stay full-res.
- **Fonts are referenced, never bundled.** ABC Diatype is a licensed Dinamo font.
  Do not commit font files or `@font-face` with an embedded font.

## Common tasks

- **Add a new animation type:** add an option to the `#animMode` `<select>`, then add a
  branch in the animation block inside `drawScene` (and it will automatically work in
  the sequence export, since export reuses `drawScene`).
- **Add a new export format:** add a button in the Export `<details>`, write a handler
  that reads from `collectItems()` (for vector/data) or renders via `drawScene` to an
  offscreen canvas (for raster).
- **Add a control:** add the input to the sidebar, add a field to `DEFAULTS` and `state`,
  bind it (mutate state → `draw()`/`rebuild()` → `commit()` for undo), and add a line to
  `syncUIFromState()` so undo/reset/load restore it.

## Testing

There's no test runner. To verify a change: open `index.html` in a browser and check
the preview updates, then test each export button. The core math (RNG determinism,
ASCII brightness mapping, grid-lock sizing) is pure and can be checked by copying those
functions into a Node script if needed.

### The v2 app (`app/`)

`app/` has three headless checks — run all of them with `cd app && npm run check`:

- `npm run typecheck` — `tsc -b`. Clean on a good tree, so any error is yours.
- `npm run check:math` — compiles the **DOM-free** engine modules (`engine/halftone/*`,
  `engine/tone.ts`, `engine/rng.ts`, `engine/cover.ts`, `domain/params.ts`,
  `domain/scene.ts`, `domain/project.ts`, `domain/sources.ts`) with `tsc` and runs
  `scripts/check-halftone.cjs` under node: screen geometry, tone mapping, dot-size response,
  the dither algorithms, the run merge, determinism, the cover-fit crop — plus the whole
  save/reopen surface (clip-reference collection, the re-link rewrite, the version-1 → 2
  source migration, round-tripping, and every way a bad file is refused).
  **Those files must stay DOM-free** or this stops working.
- `npm run check:smoke` — a Vite SSR build of `src/__smoke.tsx`, then `node`. This is
  the only headless way to catch runtime faults `tsc` cannot see: a panel dereferencing
  a param a mode doesn't declare, a mode-registry import cycle, conditional-control
  visibility, the scene-level source reaching every mode as context, the scene timeline
  track and its easing inspector, and the painter/exporter behaviour for every shape. Video is
  covered here only as far as it can be without a browser: ref routing, the readiness
  probe's pending/not-pending contract, and clip frame timing (`clipMs` is exported
  purely because it is the one pure part). Decoding and seeking are not.

Still browser-only, and worth doing by hand after engine changes: interactive latency
while dragging sliders, and the six export buttons (especially transparent-background
PNG/SVG and the GIF/MP4-on-white paths).

### Sampling a source: resolution is not shape (`engine/sampleGrid.ts`, `engine/cover.ts`)

Every mode that reads pixels asks for a `SampleGrid`: `{ cols, rows, aspect }`. Build it
with `gridFor(cols, rows, ctx.width, ctx.height)` — never by hand.

`cols`/`rows` size the buffer; `aspect` is the width/height of the **canvas region** the
buffer will be stretched across. They are separate because a mode samples at whatever
resolution suits it — ASCII takes one cell per character, the dot screen uses a fixed
working grid — so `cols/rows` is *not* the shape of the thing on screen. Cropping against
`cols/rows` is a **silent** bug: ASCII's 80×45 default is 16:9 to the digit, so it looked
right on an HD canvas and stretched the picture on every other one. `coverCrop` is split
into its own DOM-free module so the invariant (the crop's aspect IS the target aspect) is
checked headlessly rather than by eye.

ASCII no longer *has* a column and row count to get wrong: its grid comes from one **cell
size** in px via `gridForCell(cell, W, H)` (`engine/cells.ts`, DOM-free and checked in
`check:math`), and its type size is a percentage of that cell so resizing the cell rescales
the glyphs with it. The grid is therefore always within half a cell of the canvas's ratio.
Files that predate this carry `cols`/`rows`/`size` and are migrated on load — see the v2→3
step in `domain/project.ts`, which touches ASCII layers ONLY: those three keys still mean
what they always did in generative mode.

### One source per composition (`domain/scene.ts`)

The picture every mode screens lives on the **Scene**, not on a layer: `scene.source`
is `{ image, srcTime }`, where `image` is a still's data URL or a `video:N` clip
reference. One canvas, many treatments — you load a photo once and stack a halftone over
an ASCII pass over a dither of the same frame.

Three consequences worth knowing before you touch this:

- **Modes receive the source as `ModeContext`, never as a param.** A mode that declared
  `image` would be a second, stale copy, and a mode switch could resurrect it — the exact
  bug this shape removes. `check:smoke` asserts no mode declares `image`/`srcTime`.
- **`srcTime` is keyable through the `'scene'` slot.** `Slot` has a fourth member; actions
  called with it ignore their `layerId` (pass `SCENE_LAYER`). That is what lets one set of
  keyframe actions, one timeline row type and one easing inspector serve scene params too,
  and why `readSlotParam(scene, layerId, slot, key)` — not `readParam(layer, …)` — is the
  entry point for anything holding a selection.
- **Version-1 files must be migrated, not read.** They kept `image`/`srcTime` in each
  layer's params. `migrateScene()` hoists the bottom-most one and strips the keys; it runs
  in `parseProject` (files), `loadProject` (any adoption) and `applyProject` — the last one
  **before** `collectClipRefs`, because a v1 scene's clip ref is somewhere `collectClipRefs`
  no longer looks, and reserving nothing is how a fresh upload steals a restored reference.

### Persistence (`state/persist.ts`, `lib/idb.ts`)

Work autosaves to IndexedDB (not localStorage — one uploaded photo is a multi-megabyte
data URL and blows past the ~5MB ceiling) and is restored on the next visit. Two rules
that are easy to break:

- **`reserveVideoRefs` must run before a restored scene lands.** Clip ids come from a
  per-session counter, so a restored scene pointing at `video:1` and the next uploaded
  clip — also minted `video:1` — would collide and that layer would silently render the
  wrong file. `applyProject()` reserves first, then loads; keep that order.
- **The clip manifest is the only surviving record of a missing clip.** A browser cannot
  keep a video file across a reload, so after a restore the file is gone and
  `store.clips` holds the last description of it. Describe clips from live `videoInfo`
  *falling back* to that manifest — rebuilding from live state alone renames every
  missing clip to "Unknown clip" and destroys the one clue about which file to re-link.

IndexedDB itself has no headless coverage. It is verified with playwright-core against
real Chrome (see the browser recipe): autosave across a reload, the restore notice, the
`.ggs` file round trip, "start fresh" keeping the previous project in Recent, and the
missing-clip alert naming the file. Re-run that after touching this layer.

For a **video source** specifically, the things that only a browser can tell you — and the
checks that matter, because each one has a plausible silent failure:

1. Load a clip in Halftone. Step the playhead and confirm the art changes; step back and
   confirm the earlier frame returns exactly. (A seek that never lands looks like a still.)
   The FIRST paint after a mode switch is allowed to differ: until the decoder answers, the
   canvas shows what it has and repaints when the real frame lands. It converges by the
   second visit, and exports never take the substitute.
2. Export a PNG sequence and confirm the frames differ from each other. This is the
   decisive one: a broken `paintSettled` gives a zip with the right frame *count* and the
   same picture in every file. Do it on a **cold** cache (fresh load, first export) — a
   second export reads everything back from the frame cache and passes regardless. The
   panel now also states how many frames it could not read in time; that line appearing
   is itself a finding.
3. Export MP4 and check the frame count is `fps × duration` and that it opens in a player.
   In Safari specifically — that path has no automated coverage at all (see below).
4. Scrub fast, then let go — the canvas should lag and catch up, never blank or flicker.
5. **Press play, then pause.** The frame must become *exact* on pause with no further
   interaction: step away and back and compare. During playback the canvas shows the
   presented video frame, which is close but not the frame that was asked for, and nothing
   in the scene changes when you pause — so if the repaint on leaving the live regime is
   ever lost, the artwork you stopped on is not the artwork you export.
6. Play at 6 / 12 / 25 fps and confirm the picture visibly *steps* at that rate and the frame
   readout increments by exactly one. Change fps mid-playback: the playhead must continue from
   the same second, not jump.
7. Firefox, which has no `requestVideoFrameCallback` — playback must still advance via the
   clip-clock fallback.

Neither Safari nor Firefox can be automated here, so both MP4 negotiation and the rVFC
fallback are written to be correct by construction and to log why they degraded. If a video
or MP4 report comes in, ask for the console output first — it names the reason.

## Deployment

Push to `main` → the GitHub Actions workflow publishes to GitHub Pages automatically.
Nothing to build. The live URL is `https://<username>.github.io/glyph-grid-studio/`.
