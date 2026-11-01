import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsClient } from '@/lib/hooks/useIsClient';

/**
 * Renders children into `document.body`. Renders nothing on the server and
 * during hydration, so overlays never appear in prerendered markup.
 */
export function Portal({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(children, document.body);
}
