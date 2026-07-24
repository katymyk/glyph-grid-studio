import { Slider } from '@base-ui/react/slider';
import { resolveParam, type Param } from './domain/params';
import { Stage } from './canvas/Stage';
import { useStudio } from './state/store';

/** Phase-1 shell: one Base UI slider driving the generative layer's size,
    proving store -> engine -> canvas end to end. Real panels come next. */
export function App() {
  const scene = useStudio((s) => s.scene);
  const setConstParam = useStudio((s) => s.setConstParam);

  const layer = scene.layers[0];
  const size = resolveParam(layer.params.size as Param<number>, 0);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside
        style={{
          width: 330,
          flex: '0 0 330px',
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
          padding: 'var(--space-3)',
        }}
      >
        <h1 style={{ fontSize: 14, fontFamily: 'var(--diamono)', margin: 0 }}>
          Glyph Grid Studio
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
          v2 · React + Base UI (scaffold)
        </p>

        <div style={{ marginTop: 24 }}>
          <label style={{ display: 'block', color: 'var(--muted)', fontSize: 11, marginBottom: 8 }}>
            Symbol size <span style={{ float: 'right', color: 'var(--text)' }}>{Math.round(size)}px</span>
          </label>
          <Slider.Root
            min={6}
            max={200}
            value={size}
            onValueChange={(value) =>
              setConstParam(layer.id, 'size', Array.isArray(value) ? value[0] : value)
            }
          >
            <Slider.Control style={{ display: 'flex', alignItems: 'center', height: 20 }}>
              <Slider.Track
                style={{ height: 4, width: '100%', borderRadius: 2, background: 'var(--panel-2)' }}
              >
                <Slider.Indicator style={{ borderRadius: 2, background: 'var(--accent)' }} />
                <Slider.Thumb
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                  }}
                />
              </Slider.Track>
            </Slider.Control>
          </Slider.Root>
        </div>
      </aside>

      <Stage />
    </div>
  );
}
