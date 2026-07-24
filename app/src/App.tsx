import { Stage } from './canvas/Stage';
import { panelsForMode } from './panels/schema';
import { useStudio } from './state/store';
import { SchemaPanel } from './ui/controls';

export function App() {
  const scene = useStudio((s) => s.scene);
  const layer = scene.layers[0];
  const panels = panelsForMode(layer.mode);

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
          {panels.map((def) => (
            <SchemaPanel key={def.id} layerId={layer.id} def={def} />
          ))}
        </div>
      </aside>

      <Stage />
    </div>
  );
}
