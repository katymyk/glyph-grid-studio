import type { ReactNode } from 'react';
import { Field } from './Field';
import styles from './ui.module.css';

/** Single-select segmented control. (Presentation only — swappable for Base UI
    Toggle Group later without touching any binding logic.) */
export function Segmented({
  label,
  options,
  value,
  onChange,
  action,
}: {
  label?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  /** Optional leading control (e.g. the keyframe diamond). Needs `label` to show. */
  action?: ReactNode;
}) {
  const seg = (
    <div className={styles.segment}>
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? `${styles.segmentItem} ${styles.segmentOn}` : styles.segmentItem}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  return label ? (
    <Field label={label} action={action}>
      {seg}
    </Field>
  ) : (
    seg
  );
}
