import { create } from 'zustand';
import {
  konst,
  keyframed,
  withKeyframe,
  flatten,
  resolveParam,
  keysOf,
  moveKeyframe,
  removeKeyframe,
  setKeyEase,
  setKeyHold,
  setTrackEase,
  DEFAULT_EASE,
  type Param,
} from '../domain/params';
import type { EaseHalf } from '../domain/easing';
import { frameAt, frameCount, timeOfFrame } from '../domain/timeline';
import { defaultScene } from '../domain/defaults';
import { migrateScene, remapClipRef, type ClipManifest, type ProjectDoc } from '../domain/project';
import type { Layer, LayerMorph, MorphStyle, Scene, SpawnZone } from '../domain/scene';
import { getMode } from '../engine/modes';
import { onSourceReady, setFidelity } from '../engine/sourceReady';
import { clearVideoFrames } from '../engine/videoSource';
import { parseGlyphs } from '../lib/glyphs';

/**
 * Where a param lives. Every keyframe/animation action takes a slot, so the timeline
 * can drive the base mode, the morph target, layer-level props (opacity) and the
 * scene's own params through one set of actions.
 *
 * `'scene'` belongs to the document rather than to any layer, so actions called with it
 * ignore their `layerId` — pass `SCENE_LAYER`.
 */
export type Slot = 'base' | 'morph' | 'layer' | 'scene';

/** The `layerId` to pass alongside `slot: 'scene'`. Nothing reads it; naming it keeps
    the call sites from looking like a bug. */
export const SCENE_LAYER = '';

/** What the timeline has selected — drives the easing inspector. */
export type TimelineSel =
  | { kind: 'key'; layerId: string; slot: Slot; param: string; index: number }
  | { kind: 'morph'; layerId: string }
  | null;

interface StudioState {
  scene: Scene;
  activeLayerId: string;
  playhead: number;
  playing: boolean;
  imageVersion: number;
  selection: TimelineSel;
  past: Scene[];
  future: Scene[];

  /** Which saved project this session is writing to. Autosave keys off it, so starting a
      new project must mint a new one — otherwise "start fresh" overwrites what it just
      offered to restore. */
  projectId: string;
  projectName: string;
  /** True when this session's scene came back from autosave rather than being started
      here. Drives the "picked up where you left off" notice, and nothing else. */
  restored: boolean;
  /**
   * Last known description of every clip the document has referred to.
   *
   * Survives the clip itself. After a reload the file is gone but this is still here, and
   * it is the only remaining record of what the scene is asking for — so it is what lets
   * the app say "re-link beach-walk.mp4, 1920×1080, 12.4s" instead of "a video is missing".
   */
  clips: ClipManifest[];
  setProjectName: (name: string) => void;
  loadProject: (doc: ProjectDoc, opts?: { id?: string; restored?: boolean }) => void;
  newProject: () => void;
  dismissRestored: () => void;
  /** Point every reference to `from` at `to`. How re-linking a clip lands. */
  remapClip: (from: string, to: string) => void;

  selectLayer: (id: string) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, dir: number) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setLayerBlend: (id: string, blend: GlobalCompositeOperation) => void;

  // view / interaction state (not part of the scene document, not undoable)
  showGrid: boolean;
  brushSize: number;
  brushErase: boolean;
  maskVisible: boolean;
  timelineHeight: number;
  /** Elements the last paint actually drew. Reported by the Stage rather than
      recomputed, so showing it costs nothing — a second resolveScene would double
      the cost of every interaction, and a halftone screen is not cheap to resolve. */
  elementCount: number;
  setElementCount: (n: number) => void;
  toggleGrid: () => void;
  setBrushSize: (v: number) => void;
  setBrushErase: (v: boolean) => void;
  setMaskVisible: (v: boolean) => void;
  setTimelineHeight: (v: number) => void;

  setConstParam: (layerId: string, key: string, value: unknown, slot?: Slot) => void;
  /** Write a value to the base mode *and* the morph target (palette, seed, …). */
  setSharedParam: (layerId: string, key: string, value: unknown) => void;
  toggleParamAnimated: (layerId: string, key: string, t: number, slot?: Slot) => void;
  upsertKeyframe: (layerId: string, key: string, t: number, value: unknown, slot?: Slot) => void;

  // keyframe editing (timeline)
  selectTimeline: (sel: TimelineSel) => void;
  addKeyframeAt: (layerId: string, slot: Slot, key: string, t: number) => void;
  dragKeyframe: (layerId: string, slot: Slot, key: string, index: number, t: number) => void;
  deleteKeyframe: (layerId: string, slot: Slot, key: string, index: number) => void;
  setKeyframeEase: (
    layerId: string,
    slot: Slot,
    key: string,
    index: number,
    side: 'in' | 'out',
    curve: EaseHalf,
  ) => void;
  setKeyframeHold: (layerId: string, slot: Slot, key: string, index: number, hold: boolean) => void;
  setTrackEasing: (layerId: string, slot: Slot, key: string, out: EaseHalf, easeIn: EaseHalf) => void;

  // mode morph (one mode hands over to another inside one layer)
  setMorphMode: (layerId: string, mode: string | null) => void;
  setMorphRange: (layerId: string, start: number, end: number) => void;
  setMorphStyle: (layerId: string, style: MorphStyle) => void;
  setMorphEase: (layerId: string, side: 'in' | 'out', curve: EaseHalf) => void;

  setLayerMode: (layerId: string, mode: string) => void;
  setSpawn: (layerId: string, spawn: SpawnZone) => void;
  /** Load (or clear) the composition's source. One per scene — every mode that screens
      pixels reads this one. */
  setSource: (image: string | null) => void;
  setBackground: (bg: string | null) => void;
  setCanvasSize: (width: number, height: number) => void;
  setDuration: (d: number) => void;
  setFps: (fps: number) => void;
  setPlayhead: (t: number) => void;
  stepFrame: (delta: number) => void;
  play: () => void;
  pause: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  surprise: () => void;
}

/**
 * Read a param out of the slot it lives in — LAYER slots only.
 *
 * Deliberately not exported: it answers `undefined` for the scene slot, which reads as
 * "no such param" rather than "wrong function", and a caller holding a selection cannot
 * tell those apart. `readSlotParam` is the entry point; this is its layer half.
 */
function readParam(layer: Layer, slot: Slot, key: string): Param<unknown> | undefined {
  if (slot === 'scene') return undefined;
  if (slot === 'layer') return key === 'opacity' ? (layer.opacity as Param<unknown>) : undefined;
  if (slot === 'morph') return layer.morph?.params[key];
  return layer.params[key];
}

/** The scene's own animatable params. `image` is deliberately absent: one source per
    composition means it is a plain value, not a track. */
function readSceneParam(scene: Scene, key: string): Param<unknown> | undefined {
  return key === 'srcTime' ? (scene.source.srcTime as Param<unknown>) : undefined;
}

/** Read a param from any slot. The one entry point for callers that hold a scene and a
    slot rather than a layer — the timeline, the easing inspector, every control. */
export function readSlotParam(
  scene: Scene,
  layerId: string,
  slot: Slot,
  key: string,
): Param<unknown> | undefined {
  if (slot === 'scene') return readSceneParam(scene, key);
  const layer = scene.layers.find((l) => l.id === layerId);
  return layer ? readParam(layer, slot, key) : undefined;
}

/**
 * Every param of one slot, resolved at time t.
 *
 * Used by controls that depend on their SIBLINGS rather than on their own value —
 * conditional visibility (`when`) and derived readouts. Building the whole set at
 * once means one subscription instead of one per cross-reference.
 */
export function resolveSlotParams(layer: Layer, slot: Slot, t: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (slot === 'scene') return out; // scene params have no schema panel of their own
  const src = slot === 'morph' ? layer.morph?.params : layer.params;
  if (src) for (const [k, p] of Object.entries(src)) out[k] = resolveParam(p, t);
  if (slot === 'layer') out.opacity = resolveParam(layer.opacity, t);
  return out;
}

/** Put a param back into the slot it lives in. */
function writeParam(layer: Layer, slot: Slot, key: string, p: Param<unknown>): Layer {
  if (slot === 'layer') {
    return key === 'opacity' ? { ...layer, opacity: p as Param<number> } : layer;
  }
  if (slot === 'morph') {
    if (!layer.morph) return layer;
    return { ...layer, morph: { ...layer.morph, params: { ...layer.morph.params, [key]: p } } };
  }
  return { ...layer, params: { ...layer.params, [key]: p } };
}

/** Return a new scene with one param transformed by fn, wherever it lives. */
function withParam(
  scene: Scene,
  layerId: string,
  slot: Slot,
  key: string,
  fn: (p: Param<unknown>) => Param<unknown>,
): Scene {
  if (slot === 'scene') {
    const cur = readSceneParam(scene, key);
    if (!cur) return scene;
    return { ...scene, source: { ...scene.source, srcTime: fn(cur) as Param<number> } };
  }
  return {
    ...scene,
    layers: scene.layers.map((l) => {
      if (l.id !== layerId) return l;
      const cur = readParam(l, slot, key);
      if (!cur) return l;
      return writeParam(l, slot, key, fn(cur));
    }),
  };
}

const HISTORY_MAX = 80;
const modeParamsCache: Record<string, Record<string, Record<string, Param<unknown>>>> = {};
let layerSeq = 1;

/** Not part of the render path, so an unseeded id is fine here (see `surpriseScene`). */
export function newProjectId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `p-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Loading a scene from elsewhere (a file, or autosave) resets everything that describes
 * *this session's* relationship to it: history, what's selected, where the playhead is.
 * Keeping the old undo stack would let one undo jump between two unrelated documents.
 */
/**
 * Give every layer the params its mode declares but the saved document predates.
 *
 * `withParam` refuses to write a key a layer doesn't already hold, which is deliberate —
 * it is what stops a shared write from teaching a mode a param it has no idea what to do
 * with. The cost lands on any control added AFTER a project was last saved: its param is
 * absent, so the control is not merely showing a default, it is DEAD. It renders at the
 * slider's minimum and every drag is dropped in silence. That is how the tonal cuts
 * shipped — "cut darks is off and I can't turn it on" — and it would have happened again
 * on the next control added.
 *
 * So a scene arriving from outside this session is topped up from the mode defaults on the
 * way in, once, rather than being second-guessed at every read. Saved values always win;
 * only absent keys are filled. Runs AFTER `migrateScene`, which needs to see the old keys
 * before this fills in the ones that replaced them.
 */
function fillModeDefaults(scene: Scene): Scene {
  const topUp = (mode: string, params: Record<string, Param<unknown>>) => {
    let declared: Record<string, Param<unknown>>;
    try {
      declared = getMode(mode).defaultParams();
    } catch {
      return params; // a mode this build doesn't have — leave the layer exactly as saved
    }
    let out = params;
    for (const [k, v] of Object.entries(declared)) if (!(k in out)) out = { ...out, [k]: v };
    return out;
  };
  return {
    ...scene,
    layers: scene.layers.map((l) => ({
      ...l,
      params: topUp(l.mode, l.params),
      morph: l.morph ? { ...l.morph, params: topUp(l.morph.mode, l.morph.params) } : l.morph,
    })),
  };
}

function adoptScene(raw: Scene): Pick<
  StudioState,
  'scene' | 'activeLayerId' | 'past' | 'future' | 'selection' | 'playhead' | 'playing'
> {
  for (const k of Object.keys(modeParamsCache)) delete modeParamsCache[k];
  const scene = fillModeDefaults(raw);
  return {
    scene,
    activeLayerId: scene.layers[0]?.id ?? 'layer-1',
    past: [],
    future: [],
    selection: null,
    playhead: 0,
    playing: false,
  };
}

function withLayer(scene: Scene, id: string, fn: (l: Layer) => Layer): Scene {
  return { ...scene, layers: scene.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

function withMorph(scene: Scene, id: string, fn: (m: LayerMorph) => LayerMorph): Scene {
  return withLayer(scene, id, (l) => (l.morph ? { ...l, morph: fn(l.morph) } : l));
}

/**
 * Params a new set inherits from the one it replaces, so switching or morphing a
 * layer's mode reads as the SAME artwork changing form rather than two unrelated ones.
 *
 * The source is NOT in here, and no longer needs to be: it lives on the scene, so a mode
 * switch cannot touch it. This list is now only the look — palette, type, seed.
 */
const INHERITED_KEYS = ['palette', 'fontKey', 'weight', 'glyphs', 'seed'];

/** Copy the inherited params from `base` onto `params`. Keys the target set doesn't
    declare are skipped, so a mode never gains a param it doesn't understand. */
function carryInherited(
  params: Record<string, Param<unknown>>,
  base: Record<string, Param<unknown>>,
) {
  const out = { ...params };
  for (const k of INHERITED_KEYS) if (base[k] && out[k]) out[k] = base[k];
  return out;
}

/** Carry the inherited params from `base` onto a fresh param set for `targetMode`. */
function inheritParams(base: Record<string, Param<unknown>>, targetMode: string) {
  return carryInherited(getMode(targetMode).defaultParams(), base);
}

// ----- history: capture the PRE-change scene, debounced so a slider drag is one step -----
let histTimer: ReturnType<typeof setTimeout> | null = null;
let histPrev: Scene | null = null;
function flushHistory(): void {
  if (histTimer) {
    clearTimeout(histTimer);
    histTimer = null;
  }
  const p = histPrev;
  histPrev = null;
  if (p) useStudio.setState((s) => ({ past: [...s.past, p].slice(-HISTORY_MAX), future: [] }));
}
function scheduleRecord(prev: Scene): void {
  if (histPrev === null) histPrev = prev;
  if (histTimer) clearTimeout(histTimer);
  histTimer = setTimeout(flushHistory, 300);
}
function recordNow(prev: Scene): void {
  flushHistory();
  useStudio.setState((s) => ({ past: [...s.past, prev].slice(-HISTORY_MAX), future: [] }));
}

/** Randomize the ACTIVE layer's look. Uses Math.random deliberately: these become
    `konst` param values in the document, they are not part of the render path (which
    stays seeded and deterministic). The source is out of reach by construction — it is
    a scene property and this only writes layer params. */
function surpriseScene(scene: Scene, activeLayerId: string): Scene {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const layer = scene.layers.find((l) => l.id === activeLayerId) ?? scene.layers[0];
  const params = { ...layer.params };
  if (layer.mode === 'generative') {
    const sets = ['/ \\ < > -', '• ◦ ● ○', '0 1', 'A B C D E F', '↑ ↗ → ↘ ↓ ↙ ← ↖', '+ × ÷ = ≈ ∞'];
    params.glyphs = konst(parseGlyphs(pick(sets)));
    params.cols = konst(Math.round(rnd(10, 60)));
    params.rows = konst(Math.round(rnd(6, 32)));
    params.density = konst(Math.round(rnd(25, 85)));
    params.size = konst(Math.round(rnd(20, 70)));
    params.sizeJit = konst(Math.round(rnd(0, 60)));
    params.posJit = konst(Math.round(rnd(0, 50)));
    params.rotJit = konst(Math.round(rnd(0, 40)));
    params.weight = konst(pick(['300', '400', '400', '700']));
    params.seed = konst(Math.floor(Math.random() * 9999) + 1);
  } else if (layer.mode === 'ascii') {
    const ramps = [' .:-=+*#%@', ' .oO0@', ' ░▒▓█', ' .,:;irsXA253hMHGS#9B&@'];
    params.ramp = konst(pick(ramps));
    params.invert = konst(Math.random() < 0.5);
    params.contrast = konst(Math.round(rnd(70, 180)));
    params.brightness = konst(Math.round(rnd(-30, 30)));
    params.seed = konst(Math.floor(Math.random() * 9999) + 1);
  } else if (layer.mode === 'halftone') {
    params.algo = konst(pick(['halftone', 'halftone', 'halftone', 'floyd', 'atkinson', 'bayer8']));
    params.cell = konst(Math.round(rnd(6, 26)));
    params.angle = konst(pick([0, 15, 30, 45, 45, 60, 75]));
    params.lattice = konst(pick(['square', 'square', 'hex']));
    params.dotShape = konst(pick(['dot', 'dot', 'dot', 'square', 'diamond', 'ring', 'cross']));
    params.dotScale = konst(Math.round(rnd(70, 140)));
    params.sizeMap = konst(pick(['area', 'coverage', 'linear']));
    params.fill = konst(Math.round(rnd(80, 130)));
    params.jitter = konst(pick([0, 0, 0, Math.round(rnd(10, 45))]));
    params.pixel = konst(Math.round(rnd(3, 10)));
    params.contrast = konst(Math.round(rnd(80, 190)));
    params.brightness = konst(Math.round(rnd(-25, 25)));
    params.threshold = konst(Math.round(rnd(-25, 25)));
    params.invert = konst(Math.random() < 0.25);
    params.seed = konst(Math.floor(Math.random() * 9999) + 1);
  }
  return { ...scene, layers: scene.layers.map((l) => (l.id === layer.id ? { ...l, params } : l)) };
}

export const useStudio = create<StudioState>((set, get) => ({
  scene: defaultScene(),
  activeLayerId: 'layer-1',
  playhead: 0,
  playing: false,
  imageVersion: 0,
  selection: null,
  past: [],
  future: [],

  projectId: newProjectId(),
  projectName: 'Untitled',
  restored: false,
  clips: [],

  setProjectName: (name) => set({ projectName: name }),

  loadProject: (doc, opts) => {
    // Decoded frames belong to the clips of the scene being replaced; a new document has
    // no claim on ~96MB of them. The clips themselves stay registered so a re-link can
    // still find one that is already open.
    clearVideoFrames();
    set({
      // Migrated here rather than only in `parseProject`, because a restore reads the
      // document straight out of IndexedDB and never passes through the file parser.
      // It is idempotent, so a current document goes through untouched.
      ...adoptScene(migrateScene(doc.scene)),
      projectId: opts?.id ?? newProjectId(),
      projectName: doc.name,
      restored: opts?.restored ?? false,
      clips: doc.clips,
    });
  },

  // A NEW id on purpose: "start fresh" must not autosave over the project it was just
  // offering to restore. The old one stays in the recent list.
  newProject: () => {
    clearVideoFrames();
    set({
      ...adoptScene(defaultScene()),
      projectId: newProjectId(),
      projectName: 'Untitled',
      restored: false,
      clips: [],
    });
  },

  dismissRestored: () => set({ restored: false }),

  remapClip: (from, to) => {
    const cur = get().scene;
    const next = remapClipRef(cur, from, to);
    if (next === cur) return; // nothing pointed at `from`
    recordNow(cur);
    set({ future: [], scene: next });
  },

  selectLayer: (id) => set({ activeLayerId: id }),

  addLayer: () => {
    recordNow(get().scene);
    const id = `layer-${++layerSeq}`;
    set((s) => ({
      future: [],
      activeLayerId: id,
      scene: {
        ...s.scene,
        layers: [
          ...s.scene.layers,
          {
            id,
            name: `Layer ${s.scene.layers.length + 1}`,
            visible: true,
            mode: 'generative',
            opacity: konst(1),
            blendMode: 'source-over',
            spawn: { kind: 'full' },
            params: getMode('generative').defaultParams(),
            morph: null,
          },
        ],
      },
    }));
  },

  removeLayer: (id) => {
    if (get().scene.layers.length <= 1) return;
    recordNow(get().scene);
    delete modeParamsCache[id]; // its remembered params can hold a whole image
    set((s) => {
      const layers = s.scene.layers.filter((l) => l.id !== id);
      const activeLayerId = s.activeLayerId === id ? layers[layers.length - 1].id : s.activeLayerId;
      return { future: [], activeLayerId, selection: null, scene: { ...s.scene, layers } };
    });
  },

  moveLayer: (id, dir) => {
    recordNow(get().scene);
    set((s) => {
      const layers = [...s.scene.layers];
      const i = layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= layers.length) return {};
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { future: [], scene: { ...s.scene, layers } };
    });
  },

  setLayerVisible: (id, visible) => {
    recordNow(get().scene);
    set((s) => ({ future: [], scene: withLayer(s.scene, id, (l) => ({ ...l, visible })) }));
  },

  setLayerBlend: (id, blend) => {
    recordNow(get().scene);
    set((s) => ({ future: [], scene: withLayer(s.scene, id, (l) => ({ ...l, blendMode: blend })) }));
  },

  showGrid: false,
  brushSize: 80,
  brushErase: false,
  maskVisible: true,
  timelineHeight: 268,
  elementCount: 0,
  setElementCount: (n) => set((s) => (s.elementCount === n ? {} : { elementCount: n })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setBrushSize: (v) => set({ brushSize: v }),
  setBrushErase: (v) => set({ brushErase: v }),
  setMaskVisible: (v) => set({ maskVisible: v }),
  setTimelineHeight: (v) => set({ timelineHeight: Math.max(132, Math.min(620, Math.round(v))) }),

  setConstParam: (layerId, key, value, slot = 'base') => {
    scheduleRecord(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, slot, key, () => konst(value)),
    }));
  },

  setSharedParam: (layerId, key, value) => {
    scheduleRecord(get().scene);
    set((s) => ({
      future: [],
      scene: withLayer(s.scene, layerId, (l) => {
        const next = { ...l, params: { ...l.params, [key]: konst(value) } };
        if (l.morph && key in l.morph.params) {
          next.morph = { ...l.morph, params: { ...l.morph.params, [key]: konst(value) } };
        }
        return next;
      }),
    }));
  },

  // Toggle a param between constant and animated (keyframed at the playhead).
  toggleParamAnimated: (layerId, key, t, slot = 'base') => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      selection: null,
      scene: withParam(s.scene, layerId, slot, key, (p) =>
        p.kind === 'keys' ? flatten(p, t) : keyframed(resolveParam(p, t), t),
      ),
    }));
  },

  // Add/update a keyframe at the playhead (used when editing an animated param).
  upsertKeyframe: (layerId, key, t, value, slot = 'base') => {
    scheduleRecord(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, slot, key, (p) => withKeyframe(p, t, value)),
    }));
  },

  selectTimeline: (sel) => set({ selection: sel }),

  addKeyframeAt: (layerId, slot, key, t) => {
    recordNow(get().scene);
    set((s) => {
      const cur = readSlotParam(s.scene, layerId, slot, key);
      if (!cur) return {};
      const value = resolveParam(cur, t);
      const next = cur.kind === 'keys' ? withKeyframe(cur, t, value) : keyframed(value, t);
      const scene = withParam(s.scene, layerId, slot, key, () => next);
      const index = keysOf(next).findIndex((k) => Math.abs(k.t - t) < 1e-3);
      return { future: [], scene, selection: { kind: 'key', layerId, slot, param: key, index } };
    });
  },

  dragKeyframe: (layerId, slot, key, index, t) => {
    scheduleRecord(get().scene);
    set((s) => {
      const cur = readSlotParam(s.scene, layerId, slot, key);
      if (!cur || cur.kind !== 'keys') return {};
      const moved = moveKeyframe(cur, index, t);
      return {
        future: [],
        scene: withParam(s.scene, layerId, slot, key, () => moved.param),
        // dragging past a neighbour renumbers keys — keep the selection on the same one
        selection: { kind: 'key', layerId, slot, param: key, index: moved.index },
      };
    });
  },

  deleteKeyframe: (layerId, slot, key, index) => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      selection: null,
      scene: withParam(s.scene, layerId, slot, key, (p) => removeKeyframe(p, index)),
    }));
  },

  setKeyframeEase: (layerId, slot, key, index, side, curve) => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, slot, key, (p) => setKeyEase(p, index, side, curve)),
    }));
  },

  setKeyframeHold: (layerId, slot, key, index, hold) => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, slot, key, (p) => setKeyHold(p, index, hold)),
    }));
  },

  setTrackEasing: (layerId, slot, key, out, easeIn) => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, slot, key, (p) => setTrackEase(p, out, easeIn)),
    }));
  },

  setMorphMode: (layerId, mode) => {
    const cur = get().scene;
    const layer = cur.layers.find((l) => l.id === layerId);
    if (!layer) return;
    recordNow(cur);
    set((s) => ({
      future: [],
      selection: mode ? { kind: 'morph', layerId } : null,
      scene: withLayer(s.scene, layerId, (l) => {
        if (!mode) return { ...l, morph: null };
        // Reuse the existing target params when only re-picking the same mode.
        const params = l.morph?.mode === mode ? l.morph.params : inheritParams(l.params, mode);
        const d = s.scene.duration;
        return {
          ...l,
          morph: {
            mode,
            params,
            // default: hold the base mode, hand over across the middle, land on the target
            start: l.morph?.start ?? d * 0.2,
            end: l.morph?.end ?? d * 0.8,
            style: l.morph?.style ?? 'dissolve',
            easeOut: l.morph?.easeOut ?? DEFAULT_EASE,
            easeIn: l.morph?.easeIn ?? DEFAULT_EASE,
          },
        };
      }),
    }));
  },

  setMorphRange: (layerId, start, end) => {
    scheduleRecord(get().scene);
    set((s) => {
      const clamp = (v: number) => Math.max(0, Math.min(v, s.scene.duration));
      // keep the range ordered — typing end < start in the inspector would otherwise
      // leave a range that never hands over
      const a = clamp(Math.min(start, end));
      const b = clamp(Math.max(start, end));
      return { future: [], scene: withMorph(s.scene, layerId, (m) => ({ ...m, start: a, end: b })) };
    });
  },

  setMorphStyle: (layerId, style) => {
    recordNow(get().scene);
    set((s) => ({ future: [], scene: withMorph(s.scene, layerId, (m) => ({ ...m, style })) }));
  },

  setMorphEase: (layerId, side, curve) => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      scene: withMorph(s.scene, layerId, (m) =>
        side === 'in' ? { ...m, easeIn: curve } : { ...m, easeOut: curve },
      ),
    }));
  },

  setLayerMode: (layerId, mode) => {
    const cur = get().scene;
    const layer = cur.layers.find((l) => l.id === layerId);
    if (!layer || layer.mode === mode) return;
    recordNow(cur);
    (modeParamsCache[layerId] ??= {})[layer.mode] = layer.params;
    // Returning to a mode restores the dial settings you left it with; a mode you
    // haven't used yet starts from its defaults. Either way the shared keys are taken
    // from the mode you're LEAVING, not from the remembered set — the picture and the
    // palette belong to the layer, so switching back must not resurrect the image that
    // mode happened to hold three switches ago.
    const remembered = modeParamsCache[layerId][mode];
    const nextParams = remembered
      ? carryInherited(remembered, layer.params)
      : inheritParams(layer.params, mode);
    set((s) => ({
      future: [],
      selection: null,
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) => (l.id === layerId ? { ...l, mode, params: nextParams } : l)),
      },
    }));
  },

  setSpawn: (layerId, spawn) => {
    scheduleRecord(get().scene);
    set((s) => ({
      future: [],
      scene: { ...s.scene, layers: s.scene.layers.map((l) => (l.id === layerId ? { ...l, spawn } : l)) },
    }));
  },

  setSource: (image) => {
    const cur = get().scene;
    if (cur.source.image === image) return;
    // recordNow, not scheduleRecord: loading a picture is a discrete act, and it must be
    // one undo step of its own rather than being folded into whatever slider was last
    // dragged inside the debounce window.
    recordNow(cur);
    set((s) => ({ future: [], scene: { ...s.scene, source: { ...s.scene.source, image } } }));
  },

  setBackground: (bg) => {
    scheduleRecord(get().scene);
    set((s) => ({ future: [], scene: { ...s.scene, background: bg } }));
  },

  setCanvasSize: (width, height) => {
    scheduleRecord(get().scene);
    set((s) => ({ future: [], scene: { ...s.scene, width, height } }));
  },

  setDuration: (d) => {
    scheduleRecord(get().scene);
    set((s) => {
      const scene = { ...s.scene, duration: Math.max(0.1, d) };
      // Re-snap: shortening the loop can leave the playhead past the end, and either way
      // the frame grid it was on no longer exists.
      return { future: [], scene, playhead: timeOfFrame(scene, frameAt(scene, s.playhead)) };
    });
  },

  setFps: (fps) => {
    scheduleRecord(get().scene);
    set((s) => {
      const scene = { ...s.scene, fps: Math.max(1, Math.min(60, Math.round(fps))) };
      // Land on the new grid, or the preview sits on a time the grid never visits. This
      // does move a playhead deliberately parked off-grid; showing a frame that doesn't
      // exist is the worse of the two.
      return { future: [], scene, playhead: timeOfFrame(scene, frameAt(scene, s.playhead)) };
    });
  },

  // A raw clamped setter on purpose — NOT snapped to the frame grid. Sub-frame writes are
  // legitimate: the timeline and the easing inspector both `setPlayhead(key.t)` so that
  // sidebar edits target that key, and a key may sit anywhere. Callers that navigate
  // frames (the playback loop, stepFrame, the ruler scrub) snap for themselves.
  setPlayhead: (t) =>
    set((s) => {
      const playhead = Math.max(0, Math.min(s.scene.duration, t));
      // Idempotence guard, same reason as setElementCount: zustand notifies every
      // subscriber on any set, and the panel selectors resolve a layer's whole param set
      // per notification. A scrub that moves within one frame should cost nothing.
      return s.playhead === playhead ? {} : { playhead };
    }),

  stepFrame: (delta) => {
    setFidelity('exact'); // stepping is navigation, and a stepped frame must be the real one
    set((s) => {
      const f = frameAt(s.scene, s.playhead) + delta;
      // Clamp in frames, not seconds, so a step always lands on the grid.
      const clamped = Math.max(0, Math.min(frameCount(s.scene) - 1, f));
      return { playing: false, playhead: timeOfFrame(s.scene, clamped) };
    });
  },

  // The transport is the ONLY writer of the source-fidelity regime: playing means a video
  // may be sampled from native playback instead of a seek per frame, paused means every
  // paint gets the exact frame it asked for. Routing all three through here keeps that a
  // single fact rather than three places that must agree.
  play: () => {
    setFidelity('live');
    set({ playing: true });
  },
  pause: () => {
    setFidelity('exact');
    set({ playing: false });
  },

  undo: () => {
    flushHistory();
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return { scene: prev, past: s.past.slice(0, -1), future: [s.scene, ...s.future], selection: null };
    });
  },

  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return { scene: next, future: s.future.slice(1), past: [...s.past, s.scene], selection: null };
    }),

  reset: () => {
    recordNow(get().scene);
    // The per-layer mode-param memory holds whole uploaded images; keeping it across
    // a reset would both resurrect old params and pin that memory for the tab's life.
    for (const k of Object.keys(modeParamsCache)) delete modeParamsCache[k];
    // Decoded video frames are the largest thing the app holds (~100MB when full) and
    // are pure cache. The clips themselves stay registered — an undo can bring a scene
    // that references one straight back.
    clearVideoFrames();
    set({ future: [], scene: defaultScene(), activeLayerId: 'layer-1', selection: null });
  },

  surprise: () => {
    recordNow(get().scene);
    set((s) => ({ future: [], scene: surpriseScene(s.scene, s.activeLayerId) }));
  },
}));

onSourceReady(() => useStudio.setState((s) => ({ imageVersion: s.imageVersion + 1 })));

/** The currently-selected layer (falls back to the first if the id is stale). */
export function useActiveLayer() {
  return useStudio((s) => s.scene.layers.find((l) => l.id === s.activeLayerId) ?? s.scene.layers[0]);
}
