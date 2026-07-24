import { create } from 'zustand';
import { konst } from '../domain/params';
import { defaultScene } from '../domain/defaults';
import type { Scene } from '../domain/scene';

interface StudioState {
  scene: Scene;
  playhead: number; // seconds

  /** Set a layer param to a constant value. */
  setConstParam: (layerId: string, key: string, value: unknown) => void;
  /** Scene-level fields. */
  setBackground: (bg: string | null) => void;
  setCanvasSize: (width: number, height: number) => void;
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

  setBackground: (bg) => set((s) => ({ scene: { ...s.scene, background: bg } })),

  setCanvasSize: (width, height) =>
    set((s) => ({ scene: { ...s.scene, width, height } })),

  setPlayhead: (t) => set({ playhead: t }),
}));
