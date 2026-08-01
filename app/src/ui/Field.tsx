import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** A labeled control row: optional leading action (e.g. keyframe toggle), label,
    optional right-aligned value readout, then the control. */
export function Field({
  label,
  value,
  action,
  children,
}: {
  label: string;
  value?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {action}
          {label}
        </span>
        {value != null && <span className={styles.fieldVal}>{value}</span>}
      </label>
      {children}
    </div>
  );
}
