# Fanfold

A browser-based tool that rebuilds a picture out of type and dots. Load a photo or a video
frame, then stack halftone, ASCII and scattered-glyph treatments over it on a timeline, and
export to formats that drop straight into Figma and After Effects.

**[→ Open the live tool](https://fanfold.app)**

![Fanfold](doc/preview.png)

## What it does

Built for motion and brand design work — generative title cards, background textures, ASCII
portraits, halftone treatments and animated glyph fields for video intros.

- **Three render modes** — *generative* (scatter symbols or text across a grid), *ASCII*
  (an image as characters, with an editable ramp), and *halftone* (a rotated dot screen
  with dithering, in dot, square, pixel, ring or diamond).
- **Layers** — stack the modes over one another with blend modes and opacity. One canvas,
  many treatments of the same picture.
- **One source per composition** — load a still or a video clip once and every layer
  screens it. Scrub or play the clip and the artwork follows.
- **Timeline and keyframes** — animate any parameter, with easing you can shape per
  keyframe. Flicker, typewriter reveal, shuffle and drift come built in.
- **Spawn zones** — restrict output to the full frame, an ellipse, or a hand-painted mask.
- **Full colour control** — background and per-symbol palette, by picker or hex, or sampled
  from the image itself.
- **Reproducible** — a seed means any layout can be recreated exactly.
- **Saves itself** — work autosaves in the browser and reopens where you left it.

## Export formats

| Format | Use |
| --- | --- |
| **SVG** | Vector, fully editable in Figma — every glyph is a `<text>` element |
| **PNG @2×** | Lossless raster still |
| **GIF** | Looping animation, no editor required |
| **MP4** | H.264 where the browser can encode it, with the codec named in the filename when it can't |
| **PNG sequence (.zip)** | Frame-by-frame render, imports into After Effects as an image sequence |
| **JSON** | Element coordinates + parameters, for scripting layers in After Effects |
| **Project file** | Saves all settings and the brush mask so you can reopen and keep editing |

## Fonts

The default fonts are **ABC Diatype** and **ABC Diatype Mono** (Dinamo, commercial license).
The font files are **not** bundled — they can't be legally redistributed. If the font is
installed on your system, the tool and every export will use it automatically. Otherwise a
monospace/sans fallback is used. Generic monospace, sans-serif and serif options are also
included.

## Usage

Open [fanfold.app](https://fanfold.app) — nothing to install.

To run it locally:

```bash
cd app
npm install
npm run dev
```

## Project files

Saved projects keep the `.ggs` extension they have always had, and files saved before the
rename open unchanged. The name on the tin changed; the format did not.

## The older single-file version

Before this, the whole tool was one self-contained `index.html` — no build step, nothing to
install. It's no longer in the repo, but it isn't lost: it's kept at the tag
[`v1-final`](https://github.com/katymyk/glyph-grid-studio/tree/v1-final), and you can
[download that one file directly](https://raw.githubusercontent.com/katymyk/glyph-grid-studio/v1-final/index.html)
and open it in any browser.

It doesn't get new features — everything now happens in [`app/`](app/).

## Editing / contributing

Work in [`app/`](app/) — `npm run dev` to preview, `npm run check` before you push. See
[`CLAUDE.md`](CLAUDE.md) for a map of the code.

## License

MIT — see [`LICENSE`](LICENSE). Note the font caveat above: the MIT license covers the
tool's code, not the ABC Diatype font.
