import { Field } from './Field';
import styles from './ui.module.css';

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <textarea className={styles.textarea} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
