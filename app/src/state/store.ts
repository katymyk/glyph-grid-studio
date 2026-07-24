import { create } from 'zustand';
import { konst } from '../domain/params';
import { defaultScene } from '../domain/defaults';
import type { Scene } from '../domain/scene';

interface StudioState {
  scene: Scene;
  playhead: number; // seconds

  /** Set a layer param to a constant value (temporary demo-level action). */
  setConstParam: (layerId: string, key: string, value: unknown) => void;
  setPlayhead: (t: number) => void;
}

export const useStudio = create<StudioState>((set) => ({
  scene: defaultScene(),
  playhead: 0,

  setConstParam: (layerId, key, value) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) =>
          l.id === layerId ? { ...l, params: { ...l.params, [key]: konst(value) } } : l,
        ),
      },
    })),

  setPlayhead: (t) => set({ playhead: t }),
}));
