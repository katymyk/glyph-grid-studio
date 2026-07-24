import { useStudio } from '../state/store';
import { Panel } from '../ui/Panel';
import { Toggle } from '../ui/Toggle';

/** View aids that aren't part of the artwork (never exported). */
export function ViewPanel() {
  const showGrid = useStudio((s) => s.showGrid);
  const toggleGrid = useStudio((s) => s.toggleGrid);
  return (
    <Panel title="View">
      <Toggle label="Grid guide" checked={showGrid} onChange={() => toggleGrid()} />
    </Panel>
  );
}
