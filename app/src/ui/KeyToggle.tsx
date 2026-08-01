import styles from './ui.module.css';

/** The keyframe diamond that sits beside a control: filled when the param is
    animated. Shared by every control kind so "can I key this?" looks the same. */
export function KeyToggle({ animated, onToggle }: { animated?: boolean; onToggle: () => void }) {
  return (
    <button
      className={animated ? `${styles.kf} ${styles.kfOn}` : styles.kf}
      onClick={onToggle}
      title={animated ? 'Animated — click to freeze at the playhead' : 'Animate this parameter (adds a keyframe at the playhead)'}
    >
      ◆
    </button>
  );
}
