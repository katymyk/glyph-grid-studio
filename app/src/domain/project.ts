/**
 * A saved project: the scene, plus a manifest of the clips it refers to.
 *
 * ## Why a clip manifest exists
 *
 * A still image lives in the scene as a data URL, so it saves and restores for free. A
 * video cannot: it is referenced as `video:1` and the actual file is held by the tab
 * ([engine/videoSource.ts]). Browsers do not let a page keep a file across a reload —
 * that is a security rule, not a gap we can engineer around. So a restored project that
 * used a clip is *incomplete by construction*, and the only honest options are to say so
 * and offer to re-link, or to lie.
 *
 * The manifest is what makes saying so possible: it records the name, size and length of
 * every clip the scene points at, so after a reload the app can name the file you need to
 * find instead of rendering nothing and looking broken.
 *
 * ## Why re-linking rewrites the scene
 *
 * Re-registering a file mints a NEW reference (`video:4`, not the `video:1` that was
 * saved), because ids come from a session counter. So a re-link is a scene rewrite:
 * `remapClipRef(scene, 'video:1', 'video:4')`. That is also why `reserveVideoRefs` exists
 * on the engine side — without it, the first clip uploaded after a restore would be minted
 * as `video:1` and silently adopt a reference it has nothing to do with.
 *
 * DOM-free on purpose: this is checked headlessly (`npm run check:math`).
 */
import type { Param } from './params';
import type { Layer, Scene } from './scene';
import { isVideoRef } from './sources';

/** Bump when a change to `Scene` can't be read by the loader below. */
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = 'ggs';
const FORMAT = 'glyph-grid-studio';

/** Enough to name a clip you need to find again, and to sanity-check the one you pick. */
export interface ClipManifest {
  ref: string;
  name: string;
  width: number;
  height: number;
  duration: number; // seconds; 0 when the container never reported one
}

export interface ProjectDoc {
  format: typeof FORMAT;
  version: number;
  name: string;
  savedAt: number; // epoch ms
  scene: Scene;
  /** Every clip the scene refers to, whether or not it is currently loaded. */
  clips: ClipManifest[];
}

// ------------------------------------------------------------------ clip refs

/** Every value a param can hold across all of time — a keyframed param has many. */
function paramValues(p: Param<unknown>): unknown[] {
  return p.kind === 'const' ? [p.value] : p.keys.map((k) => k.value);
}

function eachParamSet(layer: Layer): Record<string, Param<unknown>>[] {
  return layer.morph ? [layer.params, layer.morph.params] : [layer.params];
}

/**
 * Clip references the scene points at, de-duplicated and sorted.
 *
 * Walks keyframe values too, not just the current one: `image` is normally constant, but
 * nothing in the model forbids keying it, and a save that missed a keyed reference would
 * produce a file that renders a clip it never mentions.
 */
export function collectClipRefs(scene: Scene): string[] {
  const refs = new Set<string>();
  for (const layer of scene.layers) {
    for (const set of eachParamSet(layer)) {
      for (const p of Object.values(set)) {
        for (const v of paramValues(p)) if (isVideoRef(v)) refs.add(v);
      }
    }
  }
  return [...refs].sort();
}

/** Rewrite every `from` reference to `to`. Returns the same scene object when nothing
    matched, so a no-op re-link doesn't churn the undo stack. */
export function remapClipRef(scene: Scene, from: string, to: string): Scene {
  if (from === to) return scene;
  let touched = false;

  const mapParam = (p: Param<unknown>): Param<unknown> => {
    if (p.kind === 'const') {
      if (p.value !== from) return p;
      touched = true;
      return { kind: 'const', value: to };
    }
    if (!p.keys.some((k) => k.value === from)) return p;
    touched = true;
    return { kind: 'keys', keys: p.keys.map((k) => (k.value === from ? { ...k, value: to } : k)) };
  };

  const mapSet = (set: Record<string, Param<unknown>>) => {
    const out: Record<string, Param<unknown>> = {};
    for (const [k, p] of Object.entries(set)) out[k] = mapParam(p);
    return out;
  };

  const layers = scene.layers.map((l) => ({
    ...l,
    params: mapSet(l.params),
    morph: l.morph ? { ...l.morph, params: mapSet(l.morph.params) } : null,
  }));

  return touched ? { ...scene, layers } : scene;
}

/** A stand-in for a reference nothing can describe. Named rather than inlined because
    both the save path and the missing-clip list need the same shape. */
export function unknownClip(ref: string): ClipManifest {
  return { ref, name: 'Unknown clip', width: 0, height: 0, duration: 0 };
}

/**
 * Clips the scene points at that aren't currently loaded.
 *
 * `known` is the last manifest we had for them — after a reload that is the ONLY place a
 * clip's name still exists, because the file itself is gone. Rebuilding this from live
 * state instead would list every missing clip as "Unknown clip", which is exactly the
 * information the person needs and the one thing live state cannot supply.
 */
export function missingClips(
  scene: Scene,
  known: readonly ClipManifest[],
  isLoaded: (ref: string) => boolean,
): ClipManifest[] {
  const byRef = new Map(known.map((c) => [c.ref, c]));
  return collectClipRefs(scene)
    .filter((ref) => !isLoaded(ref))
    .map((ref) => byRef.get(ref) ?? unknownClip(ref));
}

// ------------------------------------------------------------------ write

export function makeProject(
  name: string,
  scene: Scene,
  describeClip: (ref: string) => ClipManifest | null,
  savedAt: number,
): ProjectDoc {
  // A ref with no description is one whose clip was never re-linked after a restore.
  // Carry it anyway, so a save → load → save cycle doesn't quietly forget that the scene
  // still wants a clip there — which would turn a re-linkable project into a broken one.
  const clips = collectClipRefs(scene).map((ref) => describeClip(ref) ?? unknownClip(ref));
  return { format: FORMAT, version: PROJECT_VERSION, name, savedAt, scene, clips };
}

export function projectToJSON(doc: ProjectDoc): string {
  return JSON.stringify(doc, null, 2);
}

// ------------------------------------------------------------------ read

/** Thrown with a message meant for a person, not a console. */
export class ProjectParseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function bad(msg: string): never {
  throw new ProjectParseError(msg);
}

/**
 * Validate far enough that a bad file produces a sentence rather than a crash somewhere
 * inside the renderer. Deliberately structural — it checks the shape the painter walks,
 * not every param a mode might declare, because modes own their own defaults and a
 * missing param already falls back.
 */
function checkScene(v: unknown): Scene {
  if (!isObj(v)) bad('That file has no scene in it.');
  const s = v as Record<string, unknown>;
  if (!num(s.width) || !num(s.height) || s.width <= 0 || s.height <= 0) {
    bad('That project has no usable canvas size.');
  }
  if (!num(s.fps) || !num(s.duration)) bad('That project has no usable timeline.');
  if (!Array.isArray(s.layers) || s.layers.length === 0) bad('That project has no layers.');
  for (const [i, l] of s.layers.entries()) {
    if (!isObj(l)) bad(`Layer ${i + 1} is malformed.`);
    if (typeof l.id !== 'string' || typeof l.mode !== 'string') {
      bad(`Layer ${i + 1} is missing its id or mode.`);
    }
    if (!isObj(l.params)) bad(`Layer ${i + 1} has no settings.`);
    if (!isObj(l.opacity)) bad(`Layer ${i + 1} has no opacity.`);
  }
  return v as unknown as Scene;
}

function checkClips(v: unknown): ClipManifest[] {
  if (!Array.isArray(v)) return [];
  const out: ClipManifest[] = [];
  for (const c of v) {
    if (!isObj(c) || typeof c.ref !== 'string') continue;
    out.push({
      ref: c.ref,
      name: typeof c.name === 'string' ? c.name : 'Unknown clip',
      width: num(c.width) ? c.width : 0,
      height: num(c.height) ? c.height : 0,
      duration: num(c.duration) ? c.duration : 0,
    });
  }
  return out;
}

/** Parse a `.ggs` document. Throws `ProjectParseError` with a readable message. */
export function parseProject(raw: unknown): ProjectDoc {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      bad("That file isn't readable as a project — it may not be a .ggs file.");
    }
  }
  if (!isObj(v)) bad("That file isn't a Glyph Grid Studio project.");

  // The other JSON this app writes is the After Effects coordinate export, and someone
  // will open one here. Say which file they've picked rather than "not a project".
  if (v.format !== FORMAT) {
    if (Array.isArray(v.items)) {
      bad('That looks like a coordinates export (for After Effects), not a project file.');
    }
    bad("That file isn't a Glyph Grid Studio project.");
  }

  const version = num(v.version) ? v.version : 0;
  if (version > PROJECT_VERSION) {
    bad(`That project was saved by a newer version of the app (format ${version}). Update and try again.`);
  }

  return {
    format: FORMAT,
    version,
    name: typeof v.name === 'string' && v.name.trim() ? v.name : 'Untitled',
    savedAt: num(v.savedAt) ? v.savedAt : 0,
    scene: checkScene(v.scene),
    clips: checkClips(v.clips),
  };
}

/** A filename-safe version of a project name, for the download. */
export function projectFileName(name: string): string {
  const base = name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'untitled'}.${PROJECT_EXT}`;
}
