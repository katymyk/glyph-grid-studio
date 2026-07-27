import { Switch } from '@base-ui/react/switch';
import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** A labeled on/off row built on Base UI Switch. */
export function Toggle({
  label,
  checked,
  onChange,
  action,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Optional leading control (e.g. the keyframe diamond). */
  action?: ReactNode;
}) {
  return (
    <div className={styles.switchRow}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {action}
        <span
          className={styles.switchLabel}
          style={{ cursor: 'pointer' }}
          onClick={() => onChange(!checked)}
        >
          {label}
        </span>
      </span>
      <Switch.Root checked={checked} onCheckedChange={onChange} className={styles.switchTrack}>
        <Switch.Thumb className={styles.switchThumb} />
      </Switch.Root>
    </div>
  );
}
