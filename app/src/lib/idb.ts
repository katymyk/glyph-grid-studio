/**
 * The browser's own storage, wrapped in about as little as it can be.
 *
 * IndexedDB rather than localStorage for one reason: an uploaded image is held in the
 * scene as a data URL, so a project is routinely several megabytes and localStorage's
 * ~5MB ceiling is reached by one photo. IndexedDB also stores structured values, so a
 * scene goes in without a JSON round-trip.
 *
 * Two stores, because listing must stay cheap:
 *  - `projects` holds whole documents (megabytes each)
 *  - `index`    holds one small record per project (id, name, savedAt)
 * Reading the recent list touches only `index`, so opening the panel doesn't pull every
 * saved photo into memory.
 *
 * Everything here resolves rather than throws when storage is unavailable — private
 * windows, disabled storage, an origin over quota. Losing autosave is bad; a tool that
 * won't start because it couldn't open a database is worse.
 */
import type { ProjectDoc } from '../domain/project';

/* The tool was renamed to Fanfold; this string deliberately was not. It is the key the
   browser files every user's autosaved work and Recent list under, so renaming it does
   not migrate anything — it points the app at a fresh, empty database and silently
   orphans the old one. Nothing throws and nothing looks broken; the work is just gone. */
const DB_NAME = 'glyph-grid-studio';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const INDEX = 'index';
const META = 'meta';

/** One row of the recent-projects list. */
export interface ProjectIndexEntry {
  id: string;
  name: string;
  savedAt: number;
}

export interface StoredProject extends ProjectIndexEntry {
  doc: ProjectDoc;
}

/** Set when storage turned out to be unusable, so the UI can say why once. */
let unavailable: string | null = null;
export function storageUnavailable(): string | null {
  return unavailable;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      unavailable = 'This browser has no local storage available, so your work is not being saved.';
      return resolve(null);
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      unavailable = `Local storage could not be opened (${String(e)}), so your work is not being saved.`;
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      unavailable =
        'This browser blocked local storage (private browsing does this), so your work is not being saved.';
      resolve(null);
    };
    // Another tab holding an old version open. Don't hang the app waiting for it.
    req.onblocked = () => {
      unavailable = 'Another tab has this app open with an older storage version. Close it and reload.';
      resolve(null);
    };
  });
  return dbPromise;
}

/** Run one transaction. Resolves to `fallback` on any storage failure. */
function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fallback: T,
  run: (t: IDBTransaction, done: (v: T) => void) => void,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(fallback);
        let out = fallback;
        let t: IDBTransaction;
        try {
          t = db.transaction(stores, mode);
        } catch {
          return resolve(fallback);
        }
        t.oncomplete = () => resolve(out);
        t.onabort = t.onerror = () => {
          // QuotaExceededError is the one worth naming: it means the next autosave will
          // fail too, and the user can act on it (delete a project, remove a big photo).
          const err = t.error;
          if (err?.name === 'QuotaExceededError') {
            unavailable = 'Local storage is full — delete a saved project to keep autosaving.';
          }
          resolve(fallback);
        };
        run(t, (v) => {
          out = v;
        });
      }),
  );
}

// ------------------------------------------------------------------ projects

export function putProject(rec: StoredProject): Promise<boolean> {
  return tx([PROJECTS, INDEX], 'readwrite', false, (t, done) => {
    t.objectStore(PROJECTS).put(rec);
    t.objectStore(INDEX).put({ id: rec.id, name: rec.name, savedAt: rec.savedAt });
    done(true);
  });
}

export function getProject(id: string): Promise<StoredProject | null> {
  return tx<StoredProject | null>([PROJECTS], 'readonly', null, (t, done) => {
    const r = t.objectStore(PROJECTS).get(id);
    r.onsuccess = () => done((r.result as StoredProject | undefined) ?? null);
  });
}

export function deleteProject(id: string): Promise<boolean> {
  return tx([PROJECTS, INDEX], 'readwrite', false, (t, done) => {
    t.objectStore(PROJECTS).delete(id);
    t.objectStore(INDEX).delete(id);
    done(true);
  });
}

/** Recent projects, newest first. Reads only the small index store. */
export function listProjects(): Promise<ProjectIndexEntry[]> {
  return tx<ProjectIndexEntry[]>([INDEX], 'readonly', [], (t, done) => {
    const r = t.objectStore(INDEX).getAll();
    r.onsuccess = () => {
      const rows = (r.result as ProjectIndexEntry[]) ?? [];
      done(rows.sort((a, b) => b.savedAt - a.savedAt));
    };
  });
}

// ------------------------------------------------------------------ meta

export function getMeta<T>(key: string): Promise<T | null> {
  return tx<T | null>([META], 'readonly', null, (t, done) => {
    const r = t.objectStore(META).get(key);
    r.onsuccess = () => done((r.result as T | undefined) ?? null);
  });
}

export function setMeta(key: string, value: unknown): Promise<boolean> {
  return tx([META], 'readwrite', false, (t, done) => {
    t.objectStore(META).put(value, key);
    done(true);
  });
}
