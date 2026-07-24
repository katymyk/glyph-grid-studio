import { Field } from './Field';
import styles from './ui.module.css';

/** Single-select segmented control. (Presentation only — swappable for Base UI
    Toggle Group later without touching any binding logic.) */
export function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
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
  return label ? <Field label={label}>{seg}</Field> : seg;
}
