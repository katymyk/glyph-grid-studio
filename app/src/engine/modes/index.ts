import type { RenderMode } from './types';
import { generativeMode } from './generative';
import { asciiMode } from './ascii';
import { particleMode } from './particle';

const registry = new Map<string, RenderMode>();

export function registerMode(mode: RenderMode): void {
  registry.set(mode.key, mode);
}

export function getMode(key: string): RenderMode {
  const m = registry.get(key);
  if (!m) throw new Error(`unknown render mode: ${key}`);
  return m;
}

export function listModes(): RenderMode[] {
  return [...registry.values()];
}

// Built-in modes register on import.
registerMode(generativeMode);
registerMode(asciiMode);
registerMode(particleMode);

export type { RenderMode, ModeContext } from './types';
