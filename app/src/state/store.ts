import { create } from 'zustand';
import { konst, keyframed, withKeyframe, flatten, resolveParam, type Param } from '../domain/params';
import { defaultScene } from '../domain/defaults';
import type { Scene, SpawnZone } from '../domain/scene';
import { getMode } from '../engine/modes';
import { onSampleReady } from '../engine/imageSample';
import { parseGlyphs } from '../lib/glyphs';

interface StudioState {
  scene: Scene;
  activeLayerId: string;
  playhead: number;
  playing: boolean;
  imageVersion: number;
  past: Scene[];
  future: Scene[];

  selectLayer: (id: string) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, dir: number) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlend: (id: string, blend: GlobalCompositeOperation) => void;

  // view / interaction state (not part of the scene document, not undoable)
  showGrid: boolean;
  brushSize: number;
  brushErase: boolean;
  maskVisible: boolean;
  toggleGrid: () => void;
  setBrushSize: (v: number) => void;
  setBrushErase: (v: boolean) => void;
  setMaskVisible: (v: boolean) => void;

  setConstParam: (layerId: string, key: string, value: unknown) => void;
  toggleParamAnimated: (layerId: string, key: string, t: number) => void;
  upsertKeyframe: (layerId: string, key: string, t: number, value: unknown) => void;
  setLayerMode: (layerId: string, mode: string) => void;
  setSpawn: (layerId: string, spawn: SpawnZone) => void;
  setBackground: (bg: string | null) => void;
  setCanvasSize: (width: number, height: number) => void;
  setDuration: (d: number) => void;
  setFps: (fps: number) => void;
  setPlayhead: (t: number) => void;
  play: () => void;
  pause: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  surprise: () => void;
}

/** Return a new scene with one layer param transformed by fn. */
function withParam(
  scene: Scene,
  layerId: string,
  key: string,
  fn: (p: Param<unknown>) => Param<unknown>,
): Scene {
  return {
    ...scene,
    layers: scene.layers.map((l) =>
      l.id === layerId ? { ...l, params: { ...l.params, [key]: fn(l.params[key]) } } : l,
    ),
  };
}

const HISTORY_MAX = 80;
const modeParamsCache: Record<string, Record<string, Record<string, Param<unknown>>>> = {};
let layerSeq = 1;

function withLayer(scene: Scene, id: string, fn: (l: Scene['layers'][number]) => Scene['layers'][number]): Scene {
  return { ...scene, layers: scene.layers.map((l) => (l.id === id ? fn(l) : l)) };
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
      return { future: [], activeLayerId, scene: { ...s.scene, layers } };
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

  setLayerOpacity: (id, opacity) => {
    scheduleRecord(get().scene);
    set((s) => ({ future: [], scene: withLayer(s.scene, id, (l) => ({ ...l, opacity: konst(opacity) })) }));
  },

  setLayerBlend: (id, blend) => {
    recordNow(get().scene);
    set((s) => ({ future: [], scene: withLayer(s.scene, id, (l) => ({ ...l, blendMode: blend })) }));
  },

  showGrid: false,
  brushSize: 80,
  brushErase: false,
  maskVisible: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setBrushSize: (v) => set({ brushSize: v }),
  setBrushErase: (v) => set({ brushErase: v }),
  setMaskVisible: (v) => set({ maskVisible: v }),

  setConstParam: (layerId, key, value) => {
    scheduleRecord(get().scene);
    set((s) => ({
      future: [],
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) =>
          l.id === layerId ? { ...l, params: { ...l.params, [key]: konst(value) } } : l,
        ),
      },
    }));
  },

  // Toggle a param between constant and animated (keyframed at the playhead).
  toggleParamAnimated: (layerId, key, t) => {
    recordNow(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, key, (p) =>
        p.kind === 'keys' ? flatten(p, t) : keyframed(resolveParam(p, t), t),
      ),
    }));
  },

  // Add/update a keyframe at the playhead (used when editing an animated param).
  upsertKeyframe: (layerId, key, t, value) => {
    scheduleRecord(get().scene);
    set((s) => ({
      future: [],
      scene: withParam(s.scene, layerId, key, (p) => withKeyframe(p, t, value)),
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
    set((s) => ({ future: [], scene: { ...s.scene, duration: Math.max(0.1, d) } }));
  },

  setFps: (fps) => {
    scheduleRecord(get().scene);
    set((s) => ({ future: [], scene: { ...s.scene, fps: Math.max(1, Math.min(60, Math.round(fps))) } }));
  },

  setPlayhead: (t) => set({ playhead: t }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),

  undo: () => {
    flushHistory();
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return { scene: prev, past: s.past.slice(0, -1), future: [s.scene, ...s.future] };
    });
  },

  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return { scene: next, future: s.future.slice(1), past: [...s.past, s.scene] };
    }),

  reset: () => {
    recordNow(get().scene);
    set({ future: [], scene: defaultScene(), activeLayerId: 'layer-1' });
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
