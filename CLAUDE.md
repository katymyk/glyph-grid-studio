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

## Deployment

Push to `main` → the GitHub Actions workflow publishes to GitHub Pages automatically.
Nothing to build. The live URL is `https://<username>.github.io/glyph-grid-studio/`.
