import { useStudio } from '../state/store';
import { Button } from '../ui/Button';
import styles from '../ui/ui.module.css';

export function ActionsBar() {
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const reset = useStudio((s) => s.reset);
  const surprise = useStudio((s) => s.surprise);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);

  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div className={styles.btnGrid3}>
        <Button onClick={undo} disabled={!canUndo}>
          ↩ Undo
        </Button>
        <Button onClick={redo} disabled={!canRedo}>
          ↪ Redo
        </Button>
        <Button onClick={reset}>⟲ Reset</Button>
      </div>
      <Button variant="primary" onClick={surprise}>
        ✦ Surprise
      </Button>
    </div>
  );
}
