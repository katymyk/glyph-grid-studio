import styles from './ui.module.css';

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Native color swatch + editable hex, with an optional remove button. */
export function ColorField({
  value,
  onChange,
  onRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove?: () => void;
}) {
  const swatch = HEX6.test(value) ? value : '#000000';
  return (
    <div className={styles.colorRow}>
      <input
        type="color"
        className={styles.colorSwatch}
        value={swatch}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className={styles.hexInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {onRemove && (
        <button className={styles.colorRemove} onClick={onRemove} title="Remove">
          ×
        </button>
      )}
    </div>
  );
}
