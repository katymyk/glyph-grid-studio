import { useEffect, useRef, useState } from 'react';
import {
  missingClips,
  parseProject,
  projectFileName,
  projectToJSON,
  ProjectParseError,
  type ClipManifest,
} from '../domain/project';
import { registerVideo, videoInfo } from '../engine/videoSource';
import { storageUnavailable, type ProjectIndexEntry } from '../lib/idb';
import { download } from '../lib/download';
import {
  applyProject,
  currentDoc,
  flushAutosave,
  openStored,
  recentProjects,
  removeStored,
  startFresh,
} from '../state/persist';
import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import styles from '../ui/ui.module.css';

/** "3 minutes ago" / "yesterday" — a saved-at stamp nobody has to decode. */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function clipDetail(c: ClipManifest): string {
  const size = c.width && c.height ? `${c.width}×${c.height}` : null;
  const len = c.duration > 0 ? `${c.duration.toFixed(1)}s` : null;
  const bits = [size, len].filter(Boolean);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

/**
 * The things you must act on, above the panels rather than inside one.
 *
 * Two of them, and both are consequences of a restore. A collapsed panel is not a
 * notification, and a scene that renders empty because its clip is gone looks like a bug
 * unless something says otherwise.
 */
export function ProjectAlerts() {
  const scene = useStudio((s) => s.scene);
  const restored = useStudio((s) => s.restored);
  const dismissRestored = useStudio((s) => s.dismissRestored);
  const remapClip = useStudio((s) => s.remapClip);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed by the ref being replaced, so two missing clips don't share one picker.
  const pickerRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<string | null>(null);

  // Derived rather than stored: a re-link rewrites the scene, so this recomputes on its
  // own and can't go stale behind the thing it describes.
  const known = useStudio((s) => s.clips);
  const missing = missingClips(scene, known, (ref) => videoInfo(ref) !== null);

  const storage = storageUnavailable();

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const oldRef = pendingRef.current;
    e.target.value = '';
    pendingRef.current = null;
    if (!f || !oldRef) return;
    setError(null);
    setBusy(oldRef);
    try {
      const info = await registerVideo(f);
      // A re-registered file gets a NEW id, so re-linking is a scene rewrite, not an
      // assignment back onto the saved reference.
      remapClip(oldRef, info.ref);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that video.');
    } finally {
      setBusy(null);
    }
  };

  if (!restored && !missing.length && !storage) return null;

  return (
    <>
      {storage && (
        <div className={`${styles.notice} ${styles.noticeWarn}`}>
          <span className={styles.noticeTitle}>Not saving</span>
          <span>{storage}</span>
          <span>Use Project → Save to file to keep your work.</span>
        </div>
      )}

      {restored && (
        <div className={styles.notice}>
          <span className={styles.noticeTitle}>Picked up where you left off</span>
          <div className={styles.btnGrid}>
            <Button onClick={dismissRestored}>Keep it</Button>
            <Button onClick={() => void startFresh()}>Start fresh</Button>
          </div>
          <span>Starting fresh keeps this one in Recent.</span>
        </div>
      )}

      {missing.length > 0 && (
        <div className={`${styles.notice} ${styles.noticeWarn}`}>
          <span className={styles.noticeTitle}>
            {missing.length === 1 ? 'A clip needs re-linking' : `${missing.length} clips need re-linking`}
          </span>
          <span>
            A browser can't keep a video file after a reload, so the clip has to be picked
            again. Everything else came back.
          </span>
          {missing.map((c) => (
            <div key={c.ref} className={styles.stackRow}>
              <div style={{ fontSize: 10.5, lineHeight: 1.45 }}>
                <span style={{ color: 'var(--text)' }}>{c.name}</span>
                <span>{clipDetail(c)}</span>
              </div>
              <Button
                disabled={busy !== null}
                onClick={() => {
                  pendingRef.current = c.ref;
                  pickerRef.current?.click();
                }}
              >
                {busy === c.ref ? 'Loading…' : 'Re-link…'}
              </Button>
            </div>
          ))}
          {error && <span style={{ color: 'var(--accent-fg)' }}>{error}</span>}
        </div>
      )}

      <input
        ref={pickerRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => void onPick(e)}
      />
    </>
  );
}

// ---------------------------------------------------------------- the panel

export function ProjectPanel() {
  const projectName = useStudio((s) => s.projectName);
  const projectId = useStudio((s) => s.projectId);
  const setProjectName = useStudio((s) => s.setProjectName);
  const scene = useStudio((s) => s.scene);

  const [recents, setRecents] = useState<ProjectIndexEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Refresh the list whenever the document changes identity or is saved under a new
  // name — those are exactly the moments the list is wrong.
  useEffect(() => {
    let live = true;
    void recentProjects().then((r) => {
      if (live) setRecents(r);
    });
    return () => {
      live = false;
    };
  }, [projectId, projectName, scene]);

  const saveFile = () => {
    const doc = currentDoc();
    download(
      new Blob([projectToJSON(doc)], { type: 'application/json' }),
      projectFileName(doc.name),
    );
  };

  const openFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    try {
      // Save the open document before replacing it, or opening a file is a way to lose work.
      await flushAutosave();
      applyProject(parseProject(await f.text()));
    } catch (err) {
      setError(
        err instanceof ProjectParseError
          ? err.message
          : `Could not open ${f.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <Panel title="Project" defaultOpen>
      <Field label="Name">
        <input
          className={styles.textInput}
          type="text"
          value={projectName}
          spellCheck={false}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </Field>

      <div className={styles.btnGrid}>
        <Button onClick={saveFile}>Save to file</Button>
        <Button onClick={() => fileRef.current?.click()}>Open file…</Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".ggs,application/json"
        style={{ display: 'none' }}
        onChange={(e) => void openFile(e)}
      />
      <div style={{ marginTop: 6 }}>
        <Button onClick={() => void startFresh()}>New project</Button>
      </div>

      {error && (
        <p style={{ fontSize: 10.5, color: 'var(--accent-fg)', lineHeight: 1.5, marginTop: 8 }}>{error}</p>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
        Your work saves itself as you go. A saved file also travels — send someone a
        <code> .ggs</code> and they get the whole composition, minus any video clip.
      </p>

      {recents.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              marginBottom: 6,
            }}
          >
            Recent
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recents.slice(0, 8).map((r) => {
              const isCurrent = r.id === projectId;
              return (
                <div
                  key={r.id}
                  className={`${styles.recentRow} ${isCurrent ? styles.recentRowOn : ''}`}
                  onClick={() => {
                    if (!isCurrent) void openStored(r.id);
                  }}
                >
                  <span className={styles.recentName}>{r.name || 'Untitled'}</span>
                  <span className={styles.recentWhen}>{isCurrent ? 'open' : ago(r.savedAt)}</span>
                  <button
                    className={styles.iconBtn}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeStored(r.id).then(() => recentProjects().then(setRecents));
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
