import styles from './ui.module.css';

/** Read-only derived text under a group of controls — used to disclose computed
    limits (e.g. the effective screen pitch once the element cap applies). */
export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readout}>
      <span className={styles.readoutLabel}>{label}</span>
      <span className={styles.readoutValue}>{value}</span>
    </div>
  );
}
