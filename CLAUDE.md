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
  `engine/tone.ts`, `engine/rng.ts`, `domain/params.ts`) with `tsc` and runs
  `scripts/check-halftone.cjs` under node: screen geometry, tone mapping, dot-size
  response, the dither algorithms, the run merge, determinism. **Those files must stay
  DOM-free** or this stops working.
- `npm run check:smoke` — a Vite SSR build of `src/__smoke.tsx`, then `node`. This is
  the only headless way to catch runtime faults `tsc` cannot see: a panel dereferencing
  a param a mode doesn't declare, a mode-registry import cycle, conditional-control
  visibility, and the painter/exporter behaviour for every placement shape. Video is
  covered here only as far as it can be without a browser: ref routing, the readiness
  probe's pending/not-pending contract, and clip frame timing (`clipMs` is exported
  purely because it is the one pure part). Decoding and seeking are not.

Still browser-only, and worth doing by hand after engine changes: interactive latency
while dragging sliders, and the six export buttons (especially transparent-background
PNG/SVG and the GIF/MP4-on-white paths).

For a **video source** specifically, the things that only a browser can tell you — and the
checks that matter, because each one has a plausible silent failure:

1. Load a clip in Halftone. Step the playhead and confirm the art changes; step back and
   confirm the earlier frame returns exactly. (A seek that never lands looks like a still.)
2. Export a PNG sequence and confirm the frames differ from each other. This is the
   decisive one: a broken `paintSettled` gives a zip with the right frame *count* and the
   same picture in every file.
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
7. Two layers on one clip at different `srcTime` — expect a console warning and a fall back
   to seeking (slow but stable), not a stall.
8. Firefox, which has no `requestVideoFrameCallback` — playback must still advance via the
   clip-clock fallback.

Neither Safari nor Firefox can be automated here, so both MP4 negotiation and the rVFC
fallback are written to be correct by construction and to log why they degraded. If a video
or MP4 report comes in, ask for the console output first — it names the reason.

## Deployment

Push to `main` → the GitHub Actions workflow publishes to GitHub Pages automatically.
Nothing to build. The live URL is `https://<username>.github.io/glyph-grid-studio/`.
