import type { ReactNode } from 'react';
import styles from './ui.module.css';

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary';
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={variant === 'primary' ? `${styles.btn} ${styles.btnPrimary}` : styles.btn}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
