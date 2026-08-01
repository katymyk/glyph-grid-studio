import type { ReactNode } from 'react';
import { Field } from './Field';
import styles from './ui.module.css';

/** Single-select dropdown, for option sets too long to fit a segmented row. */
export function Select({
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
  const sel = (
    <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return label ? (
    <Field label={label} action={action}>
      {sel}
    </Field>
  ) : (
    sel
  );
}
