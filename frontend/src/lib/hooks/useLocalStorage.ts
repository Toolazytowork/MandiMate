import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

/** Same-tab writes are broadcast with this event; other tabs are covered by the native `storage` event. */
const LOCAL_EVENT = 'mandimate:local-storage';

interface LocalStorageEventDetail {
  key: string;
}

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota, blocked site data); readers then fall back to their default.
  }
  window.dispatchEvent(new CustomEvent<LocalStorageEventDetail>(LOCAL_EVENT, { detail: { key } }));
}

function subscribeTo(key: string) {
  return (onChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) onChange();
    };
    const onLocal = (event: Event) => {
      if ((event as CustomEvent<LocalStorageEventDetail>).detail.key === key) onChange();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LOCAL_EVENT, onLocal);
    };
  };
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * JSON value persisted in localStorage and kept in sync across components and tabs.
 * SSR and hydration render `initialValue`; the stored value is applied right after.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [value: T, setValue: (next: T | ((previous: T) => T)) => void, remove: () => void] {
  // The fallback is captured once so callers can pass literals without re-parsing on every render.
  const [fallback] = useState(initialValue);
  const subscribe = useMemo(() => subscribeTo(key), [key]);
  const raw = useSyncExternalStore(
    subscribe,
    () => readStorage(key),
    () => null,
  );
  const value = useMemo(() => parse(raw, fallback), [raw, fallback]);

  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = parse(readStorage(key), fallback);
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      writeStorage(key, JSON.stringify(resolved));
    },
    [key, fallback],
  );

  const remove = useCallback(() => writeStorage(key, null), [key]);

  return [value, setValue, remove];
}
