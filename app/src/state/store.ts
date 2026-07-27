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
import { defaultScene } from '../domain/defaults';
import type { Layer, LayerMorph, MorphStyle, Scene, SpawnZone } from '../domain/scene';
import { getMode } from '../engine/modes';
import { onSampleReady } from '../engine/imageSample';
import { parseGlyphs } from '../lib/glyphs';

/**
 * Where a param lives on a layer. Every keyframe/animation action takes a slot, so
 * the timeline can drive the base mode, the morph target, and layer-level props
 * (opacity) through one set of actions.
 */
export type Slot = 'base' | 'morph' | 'layer';

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

  // mode morph (symbols → particles inside one layer)
  setMorphMode: (layerId: string, mode: string | null) => void;
  setMorphRange: (layerId: string, start: number, end: number) => void;
  setMorphStyle: (layerId: string, style: MorphStyle) => void;
  setMorphEase: (layerId: string, side: 'in' | 'out', curve: EaseHalf) => void;

  setLayerMode: (layerId: string, mode: string) => void;
  setSpawn: (layerId: string, spawn: SpawnZone) => void;
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

/** Read a param out of the slot it lives in. */
export function readParam(layer: Layer, slot: Slot, key: string): Param<unknown> | undefined {
  if (slot === 'layer') return key === 'opacity' ? (layer.opacity as Param<unknown>) : undefined;
  if (slot === 'morph') return layer.morph?.params[key];
  return layer.params[key];
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

/** Return a new scene with one layer param transformed by fn. */
function withParam(
  scene: Scene,
  layerId: string,
  slot: Slot,
  key: string,
  fn: (p: Param<unknown>) => Param<unknown>,
): Scene {
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

function withLayer(scene: Scene, id: string, fn: (l: Layer) => Layer): Scene {
  return { ...scene, layers: scene.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

function withMorph(scene: Scene, id: string, fn: (m: LayerMorph) => LayerMorph): Scene {
  return withLayer(scene, id, (l) => (l.morph ? { ...l, morph: fn(l.morph) } : l));
}

/** Params for a fresh morph target: keep the look-sharing bits from the base mode so
    the handover reads as the *same* artwork changing form, not two unrelated ones. */
const SHARED_KEYS = ['palette', 'fontKey', 'weight', 'glyphs', 'seed'];
function seedMorphParams(base: Record<string, Param<unknown>>, targetMode: string) {
  const params = getMode(targetMode).defaultParams();
  for (const k of SHARED_KEYS) if (base[k] && params[k]) params[k] = base[k];
  return params;
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

function surpriseScene(scene: Scene): Scene {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const layer = scene.layers[0];
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
      const layer = s.scene.layers.find((l) => l.id === layerId);
      const cur = layer && readParam(layer, slot, key);
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
      const layer = s.scene.layers.find((l) => l.id === layerId);
      const cur = layer && readParam(layer, slot, key);
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
        const params = l.morph?.mode === mode ? l.morph.params : seedMorphParams(l.params, mode);
        const d = s.scene.duration;
        return {
          ...l,
          morph: {
            mode,
            params,
            // default: hold the symbols, hand over across the middle, land on particles
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
    const nextParams = modeParamsCache[layerId][mode] ?? getMode(mode).defaultParams();
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
      const duration = Math.max(0.1, d);
      return {
        future: [],
        scene: { ...s.scene, duration },
        playhead: Math.min(s.playhead, duration),
      };
    });
  },

  setFps: (fps) => {
    scheduleRecord(get().scene);
    set((s) => ({ future: [], scene: { ...s.scene, fps: Math.max(1, Math.min(60, Math.round(fps))) } }));
  },

  setPlayhead: (t) =>
    set((s) => ({ playhead: Math.max(0, Math.min(s.scene.duration, t)) })),

  stepFrame: (delta) =>
    set((s) => {
      const fps = s.scene.fps || 25;
      const f = Math.round(s.playhead * fps) + delta;
      return { playing: false, playhead: Math.max(0, Math.min(s.scene.duration, f / fps)) };
    }),

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),

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
    set({ future: [], scene: defaultScene(), activeLayerId: 'layer-1', selection: null });
  },

  surprise: () => {
    recordNow(get().scene);
    set((s) => ({ future: [], scene: surpriseScene(s.scene) }));
  },
}));

onSampleReady(() => useStudio.setState((s) => ({ imageVersion: s.imageVersion + 1 })));

/** The currently-selected layer (falls back to the first if the id is stale). */
export function useActiveLayer() {
  return useStudio((s) => s.scene.layers.find((l) => l.id === s.activeLayerId) ?? s.scene.layers[0]);
}
