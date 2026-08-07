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
import { konst, resolveParam, type Param } from './params';
import { defaultSource, type Scene, type SceneSource } from './scene';
import { isVideoRef } from './sources';

/**
 * Bump when a change to `Scene` can't be read by the loader below.
 *
 * 2 — the source (`image` + `srcTime`) moved from every layer's params onto the scene.
 * 3 — ASCII's grid became one cell size (`cell` + `glyphScale`) instead of `cols`/`rows`
 *     and an absolute glyph size.
 *
 * Every older file still loads: `migrateScene` runs each step in turn. The steps key off
 * the SHAPE they find rather than off this number, because a file written before versions
 * were recorded at all has to migrate too.
 */
export const PROJECT_VERSION = 3;
export const PROJECT_EXT = 'ggs';
/* Both of the above outlived the rename to Fanfold on purpose. `FORMAT` is written into
   every `.ggs` ever saved and is checked on the way back in, so changing it makes
   `parseProject` reject every file that already exists — including the ones people have
   on disk. Renaming the extension strands those files in the open dialog for the same
   reason. Change either only behind a migration that still accepts the old value. */
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

/**
 * Clip references the scene points at.
 *
 * One source per composition (see `SceneSource`), so this is at most one ref — but it
 * stays a list because the manifest, the missing-clip alert and the re-link flow are all
 * written against a set, and a second source (a matte, a second plate) would slot in here
 * without touching any of them.
 */
export function collectClipRefs(scene: Scene): string[] {
  return isVideoRef(scene.source?.image) ? [scene.source.image as string] : [];
}

/** Rewrite every `from` reference to `to`. Returns the same scene object when nothing
    matched, so a no-op re-link doesn't churn the undo stack. */
export function remapClipRef(scene: Scene, from: string, to: string): Scene {
  if (from === to || scene.source?.image !== from) return scene;
  return { ...scene, source: { ...scene.source, image: to } };
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

// ------------------------------------------------------------------ migration

/** A `Param<T>`-shaped value, as far as a file can be trusted to hold one. */
function asParam<T>(v: unknown, fallback: Param<T>): Param<T> {
  if (!isObj(v)) return fallback;
  if (v.kind === 'const') return { kind: 'const', value: v.value as T };
  if (v.kind === 'keys' && Array.isArray(v.keys) && v.keys.length) return v as unknown as Param<T>;
  return fallback;
}

/** Bring a scene of any past shape forward, oldest step first. */
export function migrateScene(scene: Scene): Scene {
  return asciiCellGrid(hoistSource(scene));
}

/**
 * Bring a version-1 scene forward: the source moves from the layers onto the scene.
 *
 * In v1 every layer carried its own `image`/`srcTime`, which is why switching a layer's
 * mode had to copy them across by hand. A v1 file can therefore name several sources, and
 * this has to pick one — it takes the first layer that has one, reading bottom-up, which
 * is paint order and so is the picture that was underneath everything.
 *
 * The keys are then stripped from every param set. Leaving them would be harmless to the
 * renderer (no mode reads them now) but they would ride along in every save forever, and
 * a stale `image` in a layer is a multi-megabyte data URL cloned onto the undo stack.
 */
function hoistSource(scene: Scene): Scene {
  if (scene.source) return scene;
  let source: SceneSource | null = null;
  const strip = (set: Record<string, Param<unknown>>): Record<string, Param<unknown>> => {
    const { image, srcTime, ...rest } = set;
    if (!source && isObj(image) && typeof (image as { value?: unknown }).value === 'string') {
      source = {
        image: (image as { value: string }).value,
        srcTime: asParam<number>(srcTime, konst(0)),
      };
    }
    return rest;
  };
  const layers = scene.layers.map((l) => ({
    ...l,
    params: strip(l.params),
    morph: l.morph ? { ...l.morph, params: strip(l.morph.params) } : null,
  }));
  return { ...scene, source: source ?? defaultSource(), layers };
}

/** The value a param holds at the start of the scene, for a migration that has to reduce
    an animated param to one number. Falsy/negative reads fall back — a saved grid of 0
    columns is corrupt, not a layout to reproduce. */
function atStart(p: Param<unknown> | undefined, fallback: number): number {
  if (!p) return fallback;
  const v = resolveParam(p, 0);
  return typeof v === 'number' && v > 0 ? v : fallback;
}

/**
 * Version-2 → 3: ASCII sized its grid with `cols`/`rows` and an absolute glyph `size`. It
 * now takes one cell size in px, with the glyph size a percentage of it. Reproduce the
 * saved layout on the canvas it was saved for rather than snapping the layer back to the
 * default 24px grid.
 *
 * Two things a v2 file can say that v3 cannot, and what happens to them:
 *
 * - **A grid that wasn't the canvas's ratio.** Rows are now derived, so only one of the
 *   pair can survive; columns do, because they set the horizontal detail you were looking
 *   at. Such a scene comes back very slightly re-proportioned, which is the same squash
 *   the single cell size exists to make unreachable.
 * - **A keyframed grid.** Collapsed to its value at t=0. Three dials became one, so an
 *   animated grid has no curve to carry across; keeping the opening frame and leaving it
 *   to be re-keyed is the honest reading, and beats inventing motion.
 *
 * Only ASCII layers are touched. `cols`/`rows`/`size` still mean exactly what they always
 * did in generative mode.
 */
function asciiCellGrid(scene: Scene): Scene {
  const stale = (set: Record<string, Param<unknown>>) => 'cols' in set || 'rows' in set || 'size' in set;
  const isAscii = (l: Scene['layers'][number]) =>
    (l.mode === 'ascii' && stale(l.params)) || (l.morph?.mode === 'ascii' && stale(l.morph.params));
  if (!scene.layers.some(isAscii)) return scene; // current file — hand back the same object

  const fix = (set: Record<string, Param<unknown>>): Record<string, Param<unknown>> => {
    if (!stale(set)) return set;
    const { cols, rows: _rows, size, ...rest } = set;
    const cell = atStart(rest.cell, scene.width / atStart(cols, 80));
    return {
      ...rest,
      cell: konst(cell),
      glyphScale: konst(rest.glyphScale ? atStart(rest.glyphScale, 67) : (atStart(size, 16) / cell) * 100),
    };
  };
  return {
    ...scene,
    layers: scene.layers.map((l) => ({
      ...l,
      params: l.mode === 'ascii' ? fix(l.params) : l.params,
      morph: l.morph?.mode === 'ascii' ? { ...l.morph, params: fix(l.morph.params) } : l.morph,
    })),
  };
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
  if (!isObj(v)) bad("That file isn't a Fanfold project.");

  // The other JSON this app writes is the After Effects coordinate export, and someone
  // will open one here. Say which file they've picked rather than "not a project".
  if (v.format !== FORMAT) {
    if (Array.isArray(v.items)) {
      bad('That looks like a coordinates export (for After Effects), not a project file.');
    }
    bad("That file isn't a Fanfold project.");
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
    // Keyed off the shape, not the version number: a file written before versions were
    // taken seriously has no `source` either, and this is idempotent for one that does.
    scene: migrateScene(checkScene(v.scene)),
    clips: checkClips(v.clips),
  };
}

/** A filename-safe version of a project name, for the download. */
export function projectFileName(name: string): string {
  const base = name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'untitled'}.${PROJECT_EXT}`;
}
