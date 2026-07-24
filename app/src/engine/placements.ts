import { resolveParam } from '../domain/params';
import type { Placement, Scene, SpawnZone } from '../domain/scene';
import { getMode } from './modes';
import { getSample } from './imageSample';

export interface ResolvedLayer {
  opacity: number;
  blendMode: GlobalCompositeOperation;
  placements: Placement[];
}

/** Keep only placements allowed by the layer's spawn zone (normalized to canvas). */
function applySpawn(spawn: SpawnZone | undefined, placements: Placement[], W: number, H: number): Placement[] {
  if (!spawn || spawn.kind === 'full') return placements;
  if (spawn.kind === 'image') {
    if (!spawn.image) return placements; // no mask yet — don't filter
    const cols = 200;
    const rows = Math.max(1, Math.round((200 * H) / W));
    const sample = getSample(spawn.image, cols, rows);
    if (!sample) return placements; // decoding; repaint refilters when ready
    return placements.filter((p) => {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor((p.x / W) * cols)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor((p.y / H) * rows)));
      const lum = sample.lum[cy * cols + cx];
      return spawn.invert ? lum < 0.5 : lum >= 0.5;
    });
  }
  return placements;
}

/**
 * The single render path (§6): resolve every layer's params at time t, produce its
 * placements, and apply its spawn zone. Canvas painter and exporters both consume this.
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
    const placements = mode.placements(resolved, { width: scene.width, height: scene.height });
    out.push({
      opacity: resolveParam(layer.opacity, t),
      blendMode: layer.blendMode,
      placements: applySpawn(layer.spawn, placements, scene.width, scene.height),
    });
  }
  return out;
}
