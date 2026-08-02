# Glyph Grid Studio

A browser-based tool for generating typographic and ASCII visuals on a 1920×1080 canvas. Distribute symbols or text across a configurable grid, define spawn zones, animate them, and export to formats that drop straight into Figma and After Effects.

**[→ Open the live tool](https://katymyk.github.io/glyph-grid-studio/)**

![Glyph Grid Studio](doc/preview.png)

## What it does

Built for motion and brand design work — generative title cards, background textures, ASCII portraits, and animated glyph fields for video intros.

- **Generative mode** — scatter any symbols or text across a grid with controllable fill, size, position jitter, and rotation.
- **ASCII image mode** — upload an image and render it as ASCII art mapped onto the grid, with an editable character ramp, brightness invert, and optional image-sampled colors.
- **Spawn zones** — restrict output to the full frame, an ellipse, or a hand-painted brush mask.
- **Full color control** — background and a per-symbol palette, both editable by color picker or hex code.
- **Static and animated** — flicker, typewriter reveal, symbol shuffle, and drift, with speed / intensity / loop controls.
- **Grid lock** — optionally tie grid density to symbol size so cells always fit the glyph.
- **Reproducible** — a seed value means any layout can be recreated exactly.
- **Undo / Reset / Surprise me** for fast iteration.

## Export formats

| Format | Use |
| --- | --- |
| **SVG** | Vector, fully editable in Figma — every glyph is a `<text>` element |
| **PNG @2×** | Lossless raster still |
| **JSON** | Element coordinates + parameters, for scripting layers in After Effects |
| **PNG sequence (.zip)** | Frame-by-frame render of the animation loop, imports into After Effects as an image sequence |
| **Project file** | Saves all settings + the brush mask so you can reopen and keep editing |

## Fonts

The default fonts are **ABC Diatype** and **ABC Diatype Mono** (Dinamo, commercial license). The font files are **not** bundled — they can't be legally redistributed. If the font is installed on your system, the tool and every export will use it automatically. Otherwise a monospace/sans fallback is used. Generic monospace, sans-serif, and serif options are also included.

## Usage

Open the [live link](https://katymyk.github.io/glyph-grid-studio/) — nothing to install.

To run it locally:

```bash
cd app
npm install
npm run dev
```

## Two versions

The live site is **v2**, the app in [`app/`](app/) — React + Vite, with layers, keyframes and a timeline. That's where the work happens.

**v1** is still here as [`index.html`](index.html) at the repo root: the original single-file version, no build step and no dependencies to install. Download it and open it in any browser. It isn't deployed and doesn't get new features.

## Editing / contributing

Work on v2 in [`app/`](app/) — `npm run dev` to preview, `npm run check` before you push. See [`CLAUDE.md`](CLAUDE.md) for a map of the code.

## License

MIT — see [`LICENSE`](LICENSE). Note the font caveat above: the MIT license covers the tool's code, not the ABC Diatype font.
