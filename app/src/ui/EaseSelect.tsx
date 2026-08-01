import { EASE_OPTIONS, type EaseHalf } from '../domain/easing';
import styles from './timeline.module.css';

/** Curve picker for one end of a segment (a keyframe's ease-in or ease-out). */
export function EaseSelect({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: EaseHalf;
  onChange: (v: EaseHalf) => void;
  disabled?: boolean;
}) {
  return (
    <label className={styles.easeField} title={hint}>
      <span className={styles.easeLabel}>{label}</span>
      <select
        className={styles.easeSelect}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as EaseHalf)}
      >
        {EASE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
