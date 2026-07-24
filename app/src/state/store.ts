import { create } from 'zustand';
import { konst, type Param } from '../domain/params';
import { defaultScene } from '../domain/defaults';
import type { Scene } from '../domain/scene';
import { getMode } from '../engine/modes';
import { onSampleReady } from '../engine/imageSample';

interface StudioState {
  scene: Scene;
  playhead: number; // seconds
  imageVersion: number; // bumps when a lazily-decoded image lands, to force a repaint

  setConstParam: (layerId: string, key: string, value: unknown) => void;
  setLayerMode: (layerId: string, mode: string) => void;
  setBackground: (bg: string | null) => void;
  setCanvasSize: (width: number, height: number) => void;
  setPlayhead: (t: number) => void;
}

// Per-layer, per-mode param memory so switching modes back and forth is lossless.
const modeParamsCache: Record<string, Record<string, Record<string, Param<unknown>>>> = {};

export const useStudio = create<StudioState>((set) => ({
  scene: defaultScene(),
  playhead: 0,
  imageVersion: 0,

  setConstParam: (layerId, key, value) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) =>
          l.id === layerId ? { ...l, params: { ...l.params, [key]: konst(value) } } : l,
        ),
      },
    })),

  setLayerMode: (layerId, mode) =>
    set((s) => {
      const layer = s.scene.layers.find((l) => l.id === layerId);
      if (!layer || layer.mode === mode) return {};
      (modeParamsCache[layerId] ??= {})[layer.mode] = layer.params;
      const nextParams = modeParamsCache[layerId][mode] ?? getMode(mode).defaultParams();
      return {
        scene: {
          ...s.scene,
          layers: s.scene.layers.map((l) =>
            l.id === layerId ? { ...l, mode, params: nextParams } : l,
          ),
        },
      };
    }),

  setBackground: (bg) => set((s) => ({ scene: { ...s.scene, background: bg } })),
  setCanvasSize: (width, height) => set((s) => ({ scene: { ...s.scene, width, height } })),
  setPlayhead: (t) => set({ playhead: t }),
}));

// When an async image decode completes, bump imageVersion so the canvas repaints.
onSampleReady(() => useStudio.setState((s) => ({ imageVersion: s.imageVersion + 1 })));
