import { Field } from './Field';
import styles from './ui.module.css';

/** Row of preset chips; clicking one applies its value to the bound param. */
export function Chips({
  label,
  presets,
  onSelect,
}: {
  label: string;
  presets: { label: string; value: unknown }[];
  onSelect: (v: unknown) => void;
}) {
  return (
    <Field label={label}>
      <div className={styles.chips}>
        {presets.map((p) => (
          <button key={p.label} className={styles.chip} onClick={() => onSelect(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
    </Field>
  );
}
