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
  params: Record<string, Param<any>>              // mode-specific
}

Param<T> = { value: T }                            // constant
         | { keyframes: { t: number; value: T; easing: Easing }[] }
```

- **"Start frame → end frame"** = a param with two keyframes.
- **"Mix modes"** = two layers with different `mode`s and a blend mode.
- **Particle mode** = one more entry in the mode registry (§5). Nothing else changes.

This is the After-Effects-style scene graph; timeline, particles, and mixing all fall
out of it instead of being special-cased.

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
  and actions. The single source of truth.
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
        image.ts              # sampleImage + luminance/ramp helpers
        placements.ts         # resolvePlacements(scene, t) → Placement[]
        modes/
          index.ts            # registry: registerMode / getMode / listModes
          generative.ts
          ascii.ts
          particle.ts         # (phase 4)
        paint.ts              # paintToCanvas(ctx, placements)
        export/
          svg.ts  png.ts  json.ts  gif.ts  sequence.ts
      state/
        store.ts              # zustand: scene, selection, playhead, history, actions
      ui/                     # DESIGN SYSTEM over Base UI (customization seam)
        tokens.css            # CSS variables ported from v1 :root
        Panel.tsx             # Accordion group
        Slider.tsx  Segmented.tsx  Switch.tsx  Select.tsx
        NumberField.tsx  ColorField.tsx
        *.module.css
      panels/
        ModePanel.tsx  ContentPanel.tsx  GridPanel.tsx  CanvasPanel.tsx
        SpawnPanel.tsx  ColorsPanel.tsx  TimelinePanel.tsx  ExportPanel.tsx
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

Each phase leaves something that runs.
