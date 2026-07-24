import { Switch } from '@base-ui/react/switch';
import styles from './ui.module.css';

/** A labeled on/off row built on Base UI Switch. */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles.switchRow}>
      <span className={styles.switchLabel}>{label}</span>
      <Switch.Root checked={checked} onCheckedChange={onChange} className={styles.switchTrack}>
        <Switch.Thumb className={styles.switchThumb} />
      </Switch.Root>
    </div>
  );
}
