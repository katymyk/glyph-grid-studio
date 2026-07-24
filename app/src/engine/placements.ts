import { resolveParam } from '../domain/params';
import type { Placement, Scene } from '../domain/scene';
import { getMode } from './modes';

export interface ResolvedLayer {
  opacity: number;
  blendMode: GlobalCompositeOperation;
  placements: Placement[];
}

/**
 * The single render path (§6): resolve every layer's params at time t and
 * produce its placements. Canvas painter and vector/JSON exporters both consume
 * this, so preview and export can't drift.
 */
export function resolveScene(scene: Scene, t: number): ResolvedLayer[] {
  const out: ResolvedLayer[] = [];
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    const mode = getMode(layer.mode);
    const resolved: Record<string, unknown> = {};
    for (const [k, param] of Object.entries(layer.params)) {
      resolved[k] = resolveParam(param, t);
    }
    out.push({
      opacity: resolveParam(layer.opacity, t),
      blendMode: layer.blendMode,
      placements: mode.placements(resolved, { width: scene.width, height: scene.height }),
    });
  }
  return out;
}
