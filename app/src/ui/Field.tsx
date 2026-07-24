import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** A labeled control row with an optional right-aligned value readout. */
export function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>
        <span>{label}</span>
        {value != null && <span className={styles.fieldVal}>{value}</span>}
      </label>
      {children}
    </div>
  );
}
