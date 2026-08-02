import { useEffect } from 'react';
import { Stage } from './canvas/Stage';
import { Timeline } from './panels/Timeline';
import { panelsForMode } from './panels/schema';
import { ActionsBar } from './panels/ActionsBar';
import { ProjectAlerts, ProjectPanel } from './panels/ProjectPanel';
import { ModePanel } from './panels/ModePanel';
import { SourcePanel } from './panels/SourcePanel';
import { SpawnPanel } from './panels/SpawnPanel';
import { ViewPanel } from './panels/ViewPanel';
import { ColorsPanel } from './panels/ColorsPanel';
import { CanvasPanel } from './panels/CanvasPanel';
import { ExportPanel } from './panels/ExportPanel';
import { SeedPanel } from './panels/SeedPanel';
import { LayersPanel } from './panels/LayersPanel';
import { getMode } from './engine/modes';
import { useStudio, useActiveLayer } from './state/store';
import { SchemaPanel } from './ui/controls';

export function App() {
  const layer = useActiveLayer();
  const panels = panelsForMode(layer.mode);
  const morph = layer.morph;
  const morphPanels = morph ? panelsForMode(morph.mode) : [];

  // Undo/redo + transport keys (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useStudio.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault();
        if (s.playing) s.pause();
        else s.play();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        s.stepFrame(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        s.stepFrame(e.shiftKey ? 10 : 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        s.setPlayhead(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside
        style={{
          width: 330,
          flex: '0 0 330px',
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <header style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <h1 style={{ fontSize: 14, fontFamily: 'var(--diamono)', margin: 0, fontWeight: 600 }}>
            Glyph Grid Studio
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 11, margin: '4px 0 0' }}>
            v2 · React + Base UI
          </p>
        </header>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Above everything: a restore, a clip that needs re-linking, or storage that
              isn't working are all things to act on, and a collapsed panel is not a
              notification. Renders nothing when there is nothing to say. */}
          <ProjectAlerts />
          <ProjectPanel />
          <ActionsBar />
          {/* The composition first — the canvas it lands on and the picture every layer
              screens — then the layers, then the treatment the selected layer applies.
              Both of these are Scene properties, which is exactly why they sit above the
              layer stack rather than inside it. */}
          <CanvasPanel />
          <SourcePanel />
          <LayersPanel />
          <ModePanel />
          {panels.map((def) => (
            <SchemaPanel key={def.id} layerId={layer.id} def={def} />
          ))}

          {morph && (
            <>
              <div
                style={{
                  padding: '9px 16px',
                  background: 'var(--panel-2)',
                  borderBottom: '1px solid var(--line)',
                  borderTop: '1px solid var(--line)',
                  fontSize: 10.5,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--accent-fg)',
                }}
              >
                morph target · {getMode(morph.mode).label}
              </div>
              {morphPanels.map((def) => (
                <SchemaPanel
                  key={`morph-${def.id}`}
                  layerId={layer.id}
                  def={def}
                  slot="morph"
                  titlePrefix="→ "
                  defaultOpen={false}
                />
              ))}
            </>
          )}

          <SpawnPanel />
          <ColorsPanel />
          <ExportPanel />
          <ViewPanel />
          <SeedPanel />
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Stage />
        <Timeline />
      </main>
    </div>
  );
}
