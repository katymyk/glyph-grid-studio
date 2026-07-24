import { Collapsible } from '@base-ui/react/collapsible';
import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** A collapsible sidebar group (v1's <details> groups), built on Base UI. */
export function Panel({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={styles.panel}>
      <Collapsible.Trigger className={styles.panelTrigger}>{title}</Collapsible.Trigger>
      <Collapsible.Panel className={styles.panelBody}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
