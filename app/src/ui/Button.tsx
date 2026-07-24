import type { ReactNode } from 'react';
import styles from './ui.module.css';

export function Button({
  children,
  onClick,
  variant = 'default',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary';
}) {
  return (
    <button
      className={variant === 'primary' ? `${styles.btn} ${styles.btnPrimary}` : styles.btn}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
