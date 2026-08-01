/**
 * Autosave, restore, and the recent-projects list.
 *
 * The rule this file exists to enforce: **closing the tab must never lose work.** Every
 * edit lands in the browser's own storage within a second, and the next visit comes back
 * to it. Nothing here is on the render path — saving is debounced and asynchronous, and a
 * storage failure degrades to "not saved" rather than breaking the app.
 *
 * The one thing autosave genuinely cannot carry is a video clip: a page is not allowed to
 * hold a file across a reload. So a restored project records what it was pointing at (see
 * `domain/project.ts`) and the Project panel offers to re-link it. Silence there would be
 * a lie — the scene renders empty and looks broken instead of incomplete.
 */
import {
  collectClipRefs,
  makeProject,
  type ClipManifest,
  type ProjectDoc,
} from '../domain/project';
import { reserveVideoRefs, videoInfo } from '../engine/videoSource';
import {
  deleteProject,
  getMeta,
  getProject,
  listProjects,
  putProject,
  setMeta,
  type ProjectIndexEntry,
} from '../lib/idb';
import { useStudio } from './store';

const CURRENT_ID = 'currentProjectId';

/** Long enough that a slider drag is one write, short enough that a closed tab loses
    nothing anyone would notice. */
const AUTOSAVE_MS = 700;

/**
 * The document as it stands right now.
 *
 * A clip is described from the live registry when it's loaded, and from the manifest the
 * document was opened with when it isn't. That fallback is what makes a save → reload →
 * save cycle non-destructive: without it, saving a project whose clip you haven't
 * re-linked yet would overwrite the clip's name with "Unknown clip" and you'd lose the
 * only clue about which file to go and find.
 */
export function currentDoc(): ProjectDoc {
  const s = useStudio.getState();
  const remembered = new Map(s.clips.map((c) => [c.ref, c]));
  const describe = (ref: string): ClipManifest | null => videoInfo(ref) ?? remembered.get(ref) ?? null;
  return makeProject(s.projectName, s.scene, describe, Date.now());
}

/**
 * Adopt a document: reserve its clip ids BEFORE the scene lands, then load it.
 *
 * Order matters. Ids are minted from a session counter, so a restored scene pointing at
 * `video:1` and the next upload — also `video:1` — would collide. Reserving first closes
 * that window entirely rather than narrowing it.
 */
export function applyProject(doc: ProjectDoc, opts?: { id?: string; restored?: boolean }): void {
  reserveVideoRefs(collectClipRefs(doc.scene));
  useStudio.getState().loadProject(doc, opts);
}

// ------------------------------------------------------------------ autosave

let timer: ReturnType<typeof setTimeout> | null = null;
/** The scene reference already written. Guards the write that a programmatic load would
    otherwise trigger to store what was just read out of storage. */
let savedScene: unknown = null;
let savedName: string | null = null;

async function write(): Promise<void> {
  const s = useStudio.getState();
  const doc = currentDoc();
  savedScene = s.scene;
  savedName = s.projectName;
  const okWrite = await putProject({
    id: s.projectId,
    name: s.projectName,
    savedAt: doc.savedAt,
    doc,
  });
  if (okWrite) await setMeta(CURRENT_ID, s.projectId);
}

/** Write now rather than on the debounce — used before an action that replaces the scene. */
export async function flushAutosave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await write();
}

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void write();
  }, AUTOSAVE_MS);
}

// ------------------------------------------------------------------ boot

let started = false;

/**
 * Restore the last session, then keep saving. Safe to await; safe to ignore.
 *
 * Deliberately does NOT block first paint — the app renders its default scene and the
 * restored one replaces it a moment later. Waiting on storage before showing anything
 * would trade a flicker for a blank window on a slow disk.
 */
export async function initPersistence(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const id = await getMeta<string>(CURRENT_ID);
    if (id) {
      const rec = await getProject(id);
      // An empty layer list would have been rejected on the way in; this is the
      // belt-and-braces case of a record truncated by a failed write.
      if (rec?.doc?.scene?.layers?.length) {
        applyProject(rec.doc, { id: rec.id, restored: true });
      }
    }
  } catch {
    // A restore that fails leaves the default scene on screen, which is the correct
    // fallback — there is nothing to tell the user to do about it.
  }

  useStudio.subscribe((s) => {
    if (s.scene === savedScene && s.projectName === savedName) return;
    scheduleSave();
  });

  // A tab closed inside the debounce window would otherwise lose the last edit. Not a
  // guarantee — the browser may kill the page first — which is why the window is short.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (timer) void flushAutosave();
    });
  }
}

// ------------------------------------------------------------------ library

export function recentProjects(): Promise<ProjectIndexEntry[]> {
  return listProjects();
}

/** Open a stored project, saving the current one first so switching never loses it. */
export async function openStored(id: string): Promise<boolean> {
  await flushAutosave();
  const rec = await getProject(id);
  if (!rec?.doc?.scene?.layers?.length) return false;
  applyProject(rec.doc, { id: rec.id });
  await setMeta(CURRENT_ID, rec.id);
  return true;
}

export async function removeStored(id: string): Promise<void> {
  await deleteProject(id);
  if (useStudio.getState().projectId === id) await setMeta(CURRENT_ID, null);
}

/** Start a blank project, keeping the current one in the recent list. */
export async function startFresh(): Promise<void> {
  await flushAutosave();
  useStudio.getState().newProject();
  await setMeta(CURRENT_ID, useStudio.getState().projectId);
}
