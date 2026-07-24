import { useEffect } from 'react';
import { Stage } from './canvas/Stage';
import { Transport } from './panels/Transport';
import { panelsForMode } from './panels/schema';
import { ActionsBar } from './panels/ActionsBar';
import { ModePanel } from './panels/ModePanel';
import { AsciiImagePanel } from './panels/AsciiImagePanel';
import { SpawnPanel } from './panels/SpawnPanel';
import { ViewPanel } from './panels/ViewPanel';
import { ColorsPanel } from './panels/ColorsPanel';
import { CanvasPanel } from './panels/CanvasPanel';
import { ExportPanel } from './panels/ExportPanel';
import { SeedPanel } from './panels/SeedPanel';
import { useStudio } from './state/store';
import { SchemaPanel } from './ui/controls';

export function App() {
  const scene = useStudio((s) => s.scene);
  const layer = scene.layers[0];
  const panels = panelsForMode(layer.mode);

  // Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useStudio.getState().redo();
        else useStudio.getState().undo();
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
          <ActionsBar />
          <ModePanel />
          {layer.mode === 'ascii' && <AsciiImagePanel />}
          {panels.map((def) => (
            <SchemaPanel key={def.id} layerId={layer.id} def={def} />
          ))}
          <SpawnPanel />
          <ColorsPanel />
          <CanvasPanel />
          <ExportPanel />
          <ViewPanel />
          <SeedPanel />
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Stage />
        <Transport />
      </main>
    </div>
  );
}
