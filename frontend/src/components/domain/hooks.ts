import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { isLanguage } from '@/lib/i18n';
import type { Language } from '@/types/api';

/** The active UI language narrowed to the supported set; re-renders when the language changes. */
export function useUiLanguage(): Language {
  const { i18n } = useTranslation();
  return isLanguage(i18n.language) ? i18n.language : 'en';
}

/** The current time, refreshed every `intervalMs` — for countdowns and "due in" labels. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Rendered width of an element in CSS pixels, tracked with ResizeObserver. Returns `fallback` during
 * SSR and the first client render, so markup always hydrates cleanly.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const measured = Math.round(node.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
