# Making Glyph Grid Studio friendlier and smarter

A competitive read of [effect.app](https://effect.app), an honest audit of where v2 stands
against it, and a phased plan.

Written 2026-08-01, against `app/` at commit `391fcea`.

> **This is a dated snapshot, not a live status board.** Gap #1 below ("nothing is saved")
> has since shipped — autosave to IndexedDB plus `.ggs` save/open, see `state/persist.ts`.
> The other rows have not been re-audited since, so check a row against the code before
> acting on it. Left as written because the competitive read and the ordering are still
> the argument; only the evidence column goes stale.

---

## Part 1 — What effect.app actually is

A browser-based real-time effect generator for images and video. WebGL2 + WebCodecs,
everything processed locally, no upload. Free tier, then $10/mo Pro, $18/mo Animate.

**The model.** You load media, then stack *effects* on it — like Photoshop adjustment
layers. Around 70 of them: ASCII, Halftone screen, Dither, Threshold, Risograph, Xerox,
Glitch, VHS, CRT, Duotone, Layer Mix, Motion Trails, Print Stamp, Nokia 3310, Y2K Blue,
and so on. Each effect is a handful of sliders that update live as you drag.

**What they have that matters:**

| | |
|---|---|
| **Presets** | Save any stack of effects + settings as a named preset. The thumbnail is auto-captured from your canvas. Presets can hold keyframes, so an animated look is reusable. |
| **Share links** | A preset becomes a URL. Open it and the app loads with those exact settings. This is their entire growth loop. |
| **Community** | Publish a preset; browse other people's. `/explore` has tabs: All Presets · Effects · Favorites. Click anything to preview it live on your own media. |
| **Curated starting points** | A library of art-directed presets, so nobody starts from a blank slider. |
| **Effect dock** | One click applies a randomized effect — a "show me something" button. |
| **Keyframes** | Key any slider, drag the timing, pick an interpolation curve from linear to elastic. |
| **Export** | PNG, JPEG, MP4, WebM, PNG frame sequences. 24/30/60 fps. Falls back to HEVC over 4K. Audio preserved, with a timeline mute toggle. |
| **Undo** | 50 steps. |
| **Layout choices** | "Controls Left" toggle, "Media preview On" toggle. |
| **Distribution** | Figma plugin, Chrome extension, macOS/Windows desktop app, iOS beta. |

**The most useful thing to notice:** their FAQ makes a point of saying the product is
*"deterministic real-time WebGL and WebCodecs pipelines, not generative AI."* They market
the absence of AI as a feature. So when they say "smart," they mean **curation, reuse and
good defaults** — not a model. That reframes your "smarter" ask, and I think in your
favour. See Part 4.

**What they've spent the last year shipping** (from their changelog): undo/redo → Figma
plugin → preset share links → Chrome extension → presets moved into the side panel with
auto-thumbnails → community presets → keyframes → keyframes-in-presets → desktop app →
render-on-demand for big files. Read that list again: it is almost entirely **reuse,
sharing and discovery**, not new effects. That's the tell.

---

## Part 2 — Honest comparison

### Where you are genuinely ahead

Don't lose sight of these while fixing the gaps.

1. **You export vector. They can't.** SVG for Figma and JSON coordinates for After
   Effects. effect.app is raster-only — even its Figma plugin bakes a bitmap. Your output
   is *editable artwork*. This is not a feature, it's a different product category, and
   it's your moat.
2. **Your keyframes are deeper.** Per-keyframe ease-in *and* ease-out, hold keys, track-level
   easing, a curve you can see and edit between two keys. Theirs is "pick a curve from
   linear to elastic."
3. **Mode morph.** A layer that starts as glyphs and hands over to halftone across a time
   range with its own curve. Nothing in effect.app does this.
4. **Determinism by design.** Same seed, same picture, every time. Their pipeline is
   deterministic too, but you expose the seed as a creative control.
5. **Honesty in the UI.** The element-cap readout, the "capped" annotation, the codec
   fallback note that names why the MP4 isn't H.264. Most tools hide all three.
6. **The schema-driven control system.** You can redesign the entire sidebar by editing
   data. They can't; nobody can.

### Where you're behind — ranked by how much it hurts

| # | Gap | Evidence | Hurt |
|---|---|---|---|
| 1 | **Nothing is saved. Ever.** Close the tab and the work is gone. | No `localStorage`, no `IndexedDB`, no save/load anywhere in `app/src`. v1 *had* "Save project / Load project" ([index.html:371 at tag `v1-final`](https://github.com/katymyk/glyph-grid-studio/blob/v1-final/index.html#L371)) — v2 is a regression. **(Since shipped.)** | Fatal |
| 2 | **No presets.** You cannot keep a look you made. | Only inline "quick set" chips for glyph sets and ASCII ramps. | Severe |
| 3 | **No visual discovery.** The mode picker is three words in a segmented control. | [ModePanel.tsx:23](../app/src/panels/ModePanel.tsx#L23) | Severe |
| 4 | **First run is a blank slate.** Boots into a default generative scene, no sample, no guidance. | — | Severe |
| 5 | **Blind randomness.** ✦ Surprise replaces your look with one random look. No options, no "more like this." | [store.ts:234](../app/src/state/store.ts#L234) | High |
| 6 | **No drag-and-drop.** You must click Image / Video and use a file dialog. | No `onDrop`/`dataTransfer` in the codebase. | High |
| 7 | **Sidebar is a 16-section scroll.** In halftone mode: Actions, Layers, Mode, Source, Clip, Method, Dot screen, Dot size & fill, Image tone, Ink & limits, Spawn, Colors, Canvas, Export, View, Seed. The six halftone panels all open by default. No search, no pinning, no memory of what you collapsed. | [schema.ts](../app/src/panels/schema.ts), [App.tsx:84](../app/src/App.tsx#L84) | High |
| 8 | **No zoom.** The canvas fits the viewport and that's it. You cannot inspect a 4K halftone at 1:1. v1 had zoom. | [Stage.tsx:139](../app/src/canvas/Stage.tsx#L139) | High |
| 9 | **No before/after.** For a tool that transforms a photo, you can't see the photo. | — | Medium |
| 10 | **No hints on any control.** "Tone response: Classic / Accurate / Light" — three words, no explanation of what they do. Three `title` attributes exist on layer buttons; nothing on a single parameter. | — | Medium |
| 11 | **Shortcuts are invisible.** Space, arrows, shift+arrows, Home, ⌘Z, ⌘⇧Z all work. Nothing tells you. | [App.tsx:30](../app/src/App.tsx#L30) | Medium |
| 12 | **Layer rows are thin.** No thumbnail, no rename, no duplicate, reorder is ▲▼ buttons. | [LayersPanel.tsx:53](../app/src/panels/LayersPanel.tsx#L53) | Medium |
| 13 | **No sharing.** No way to send someone a look. | — | Medium |

### What to deliberately *not* copy

- **70 effects.** Your product is three coherent modes that produce vector. Diluting into a
  filter grab-bag trades your moat for their commodity.
- **Accounts, pricing, community backend.** That's a server, a database and a moderation
  queue. Share-by-URL gets you 80% of the value with zero infrastructure.
- **Mobile.** Not where 1920×1080 vector export for Figma happens.
- **Audio in exports.** Only if you ever actually want it.

---

## Part 3 — The plan

Seven phases. Each one ships something usable on its own, and they're ordered so the
biggest relief comes first. Sizes are S / M / L relative to each other.

### Phase 0 — Stop losing work `M` — do this first, before anything else

Everything below is worthless if the work evaporates on reload.

- **Autosave.** Scene → IndexedDB on a debounce, restored on load. IndexedDB rather than
  localStorage because uploaded images are stored as data URLs and will blow past the 5MB
  localStorage ceiling immediately.
- **Save / Load project file** (`.ggs`, JSON). Restores v1 parity and gives you a real
  hand-off format.
- **Honest handling of video.** A clip is registered out-of-band as a `video:N` reference
  ([SourcePanel.tsx:10](../app/src/panels/SourcePanel.tsx#L10)) and *cannot* survive a
  reload — the browser doesn't let us keep the file. So a restored scene that references a
  clip must say so and offer **"Re-link clip…"** rather than silently rendering nothing.
  Getting this right is most of the work in this phase.
- **"Restored your last session · Start fresh"** notice on load, so a restore is never a
  surprise.

**Done when:** you can quit the browser mid-edit, reopen, and be exactly where you were —
or be told precisely what couldn't come back.

---

### Phase 1 — Looks: save, reuse, share `L` — the highest-value feature in this document

A **Look** = one layer's mode + params + keyframes, *minus* the source image. Portable by
definition, because it carries no media.

- **Save look** from the layer, with a name.
- **Thumbnail rendered by the engine**, not screenshotted — `sceneToPNGBlob` already
  renders offscreen at any size, so a 160px thumb is nearly free and always accurate.
- **Looks gallery** in the sidebar: grid of thumbnails, click to apply to the active layer.
- **~12 built-in starter looks**, art-directed by you. This is the single biggest quality
  lever in the whole plan: nobody's first experience should be a default slider position.
- **Share by URL.** Compress the look JSON into the URL hash. Opening the link loads it.
  No backend, no accounts, still deploys to GitHub Pages as a static page.
- **Looks include keyframes**, so an animated treatment is reusable — effect.app took a
  year to figure this out; you can have it from day one.

**Done when:** you can build a look on Monday, send a colleague a link, and they apply it
to their own photo on Tuesday.

---

### Phase 2 — Make it visual `M`

You're a designer choosing visual outcomes from text labels. Fix the modality.

- **Mode picker with live thumbnails** — render each mode against the current source at
  128px, so "Generative / ASCII / Halftone" becomes three pictures. Same trick as the
  Looks thumbnails; same offscreen renderer.
- **Drag and drop media** onto the canvas. Also paste from clipboard (⌘V).
- **A real first run:** a bundled sample image, three starter looks laid out as
  thumbnails, and one line of text. Not a tour, not a modal — just a canvas that already
  has something on it and three obvious next moves.
- **Empty-state copy that teaches.** You already do this well in
  [SourcePanel.tsx:113](../app/src/panels/SourcePanel.tsx#L113) — *"Dark areas grow the
  dots, bright areas shrink them."* Extend that instinct everywhere.

---

### Phase 3 — Smart, the deterministic kind `M` — this is the "smarter" ask, answered

No model needed. Every one of these is arithmetic, which means it's instant, offline,
free, and cannot be wrong in an embarrassing way.

- **Auto-tone on upload.** Read the source histogram and set brightness / contrast / gamma
  / threshold so the halftone *reads* on the first frame. Today you upload a photo and get
  a muddy screen until you've hand-tuned five sliders. This one change removes the worst
  moment in the product.
- **An "Auto-tune" button** that redoes it on demand, and after any source change.
- **Suggested density.** Derive an opening `cell` / `cols` / `rows` from canvas size and
  how much detail the source actually has, instead of a fixed default.
- **Variations, replacing ✦ Surprise.** Render six seeded mutations of the *current* look
  as thumbnails. Click one to adopt it. Then **"More like this"** re-rolls around that one
  with a tighter radius. Same randomness you already have, but you're choosing from
  candidates instead of gambling — and it composts naturally into Phase 1's Looks.
- **Export estimates.** "≈ 40s · ≈ 18 MB" before you commit. You already show element count
  and cap disclosure; this is the same honesty applied to time.
- **Guardrail warnings, not silent caps.** Consistent with what
  [schema.ts:150](../app/src/panels/schema.ts#L150) already does.

**Optional later track — actual AI.** Only if it earns its place. The one shape I'd
defend: type *"1960s risograph poster, heavy grain"* and get three candidate param sets as
thumbnails. Note that this is Phase 3's variations grid with a different generator behind
it — so build the grid first, and the AI becomes a swap-in, not a rewrite. Worth saying
plainly: effect.app markets *not* being AI, and their users like that. Deterministic
smartness is the differentiator here; a model is a bet on top of it.

---

### Phase 4 — Canvas ergonomics `M`

- **Zoom and pan.** Fit / 100% / scroll-to-zoom / space-drag to pan. Keep the backing
  canvas at full resolution so exports are unaffected — the same CSS-only approach v1 used.
- **Before / after.** Hold a key to show the untreated source. Essential for ASCII and
  halftone.
- **Source ghost underlay** at low opacity while adjusting the grid.
- **Brush cursor that shows the actual brush size**, and a brush size that scales with zoom.

---

### Phase 5 — Sidebar ergonomics `M`

All of this is schema work, which means it never touches feature logic — exactly what the
control system was built for.

- **Control search.** Type "contrast," jump to it. With sixteen sections this stops being a
  luxury.
- **Remember collapsed state** per mode, per session.
- **Pin favourites** to a section at the top.
- **Hints on controls** — add an optional `hint` field to `Control` in the schema; the
  control registry renders it. One data field, every panel benefits, zero logic touched.
- **Shortcut sheet** on `?`.
- **Left/right sidebar toggle**, if you want it — cheap, and effect.app users clearly do.

---

### Phase 6 — Layers `S`

- Thumbnail per layer, double-click to rename, duplicate button, drag to reorder.
- Show the blend mode on the row.

---

### Phase 7 — Export confidence `S`

- Named targets: *Figma (SVG)*, *After Effects (JSON + PNG sequence)*, *Instagram (MP4
  1080×1350)*, *Web (GIF)*.
- Remember the last export settings.
- Say plainly when the background is transparent and what that means per format — this
  currently only surfaces in the MP4 button label.

---

## Part 4 — What I'd actually do

If you only do three things:

1. **Phase 0.** Not optional. A tool that loses work isn't a tool.
2. **Phase 1.** Looks + share links. effect.app's whole year of changelog says this is
   where the value is, and you can have the useful 80% of it with no backend.
3. **Phase 3's auto-tone.** One afternoon's arithmetic that deletes the worst five minutes
   of using the product.

And one strategic note. Everything above closes gaps with effect.app. Your *lead* over
them is that your output is editable vector headed for Figma and After Effects. Nothing in
this plan should be paid for by weakening that — and there's a Phase 8 hiding in it that I
haven't costed: **named, grouped, Figma-native SVG structure**, so the artwork lands as
organised layers rather than four thousand loose paths. That would be worth more to your
actual colleagues than any effect in effect.app's library of seventy.

---

## Suggested order

```
Phase 0  Persistence          ██████            M   ← start here
Phase 1  Looks & sharing      ████████████      L
Phase 3  Auto-tone (pull fwd) ███               S   ← cheap, do it alongside Phase 1
Phase 2  Visual discovery     ██████            M
Phase 3  Variations + rest    ██████            M
Phase 4  Canvas ergonomics    ██████            M
Phase 5  Sidebar ergonomics   ██████            M
Phase 6  Layers               ███               S
Phase 7  Export targets       ███               S
Phase 8  Figma-native SVG     ?                 ?   ← the one that widens the lead
```
