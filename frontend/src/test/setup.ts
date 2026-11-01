/**
 * Vitest setup (jsdom): browser APIs jsdom lacks, plus the i18n instance so components that call
 * useTranslation() render real English strings.
 */
import '@/lib/i18n';

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class InertObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

if (!('IntersectionObserver' in window)) {
  Object.defineProperty(window, 'IntersectionObserver', { configurable: true, writable: true, value: InertObserver });
}

if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: InertObserver });
}

window.scrollTo = () => {};
