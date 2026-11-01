import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `false` during SSR and hydration, `true` afterwards. Use it to render browser-only UI without
 * causing hydration mismatches.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
