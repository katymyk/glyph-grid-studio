import { generativeMode } from '../engine/modes/generative';
import { konst } from './params';
import type { Scene } from './scene';

/** A fresh single-layer generative scene (mirrors v1's starting look). */
export function defaultScene(): Scene {
  return {
    width: 1920,
    height: 1080,
    fps: 25,
    duration: 4,
    background: '#ffffff',
    layers: [
      {
        id: 'layer-1',
        name: 'Glyphs',
        visible: true,
        mode: 'generative',
        opacity: konst(1),
        blendMode: 'source-over',
        params: generativeMode.defaultParams(),
      },
    ],
  };
}
