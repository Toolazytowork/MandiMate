import { useCallback, useState, type CSSProperties, type HTMLAttributes, type RefCallback } from 'react';
import { cn } from '@/lib/cn';

export interface RevealOptions {
  /** Reveal once and stop observing (default). When false, the class toggles both ways. */
  once?: boolean;
  /** IntersectionObserver rootMargin. Default reveals slightly before the element is fully in view. */
  rootMargin?: string;
  threshold?: number;
}

type VisibilityListener = (visible: boolean) => void;

interface ObserverPool {
  observer: IntersectionObserver;
  listeners: Map<Element, VisibilityListener>;
}

const pools = new Map<string, ObserverPool>();

/** One shared IntersectionObserver per option set keeps long marketing pages cheap. */
function observe(node: Element, rootMargin: string, threshold: number, listener: VisibilityListener): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true);
    return () => {};
  }
  const key = `${rootMargin}|${threshold}`;
  let pool = pools.get(key);
  if (!pool) {
    const listeners = new Map<Element, VisibilityListener>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { rootMargin, threshold },
    );
    pool = { observer, listeners };
    pools.set(key, pool);
  }
  const { observer, listeners } = pool;
  listeners.set(node, listener);
  observer.observe(node);
  return () => {
    observer.unobserve(node);
    listeners.delete(node);
  };
}

const DEFAULT_ROOT_MARGIN = '0px 0px -8% 0px';
const DEFAULT_THRESHOLD = 0.12;

/**
 * Ref callback that adds `.is-visible` to an element carrying the `.reveal` class once it scrolls
 * into view. Prerendered HTML stays fully visible: `.reveal` only hides content under `html.js`.
 * Use it on elements whose `className` does not change after mount; otherwise prefer `<Reveal>`.
 */
export function useReveal<T extends Element = HTMLElement>({
  once = true,
  rootMargin = DEFAULT_ROOT_MARGIN,
  threshold = DEFAULT_THRESHOLD,
}: RevealOptions = {}): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      if (!node) return;
      // `observe` may report synchronously (no IntersectionObserver), before `stop` is assigned.
      let stop = () => {};
      stop = observe(node, rootMargin, threshold, (visible) => {
        if (visible) {
          node.classList.add('is-visible');
          if (once) stop();
        } else if (!once) {
          node.classList.remove('is-visible');
        }
      });
      return stop;
    },
    [once, rootMargin, threshold],
  );
}

type RevealElement = 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'li' | 'p' | 'span' | 'figure';

const VARIANT_CLASS = {
  up: '',
  fade: 'reveal-fade',
  scale: 'reveal-scale',
} as const;

export interface RevealProps extends HTMLAttributes<HTMLElement>, RevealOptions {
  as?: RevealElement;
  /** Seconds to wait after entering view (use multiples of 0.06 for hand-built staggers). */
  delay?: number;
  variant?: keyof typeof VARIANT_CLASS;
}

/** Scroll reveal that is SSR-safe and survives re-renders (visibility is React state). */
export function Reveal({
  as = 'div',
  delay = 0,
  variant = 'up',
  once = true,
  rootMargin = DEFAULT_ROOT_MARGIN,
  threshold = DEFAULT_THRESHOLD,
  className,
  style,
  ...props
}: RevealProps) {
  const [visible, setVisible] = useState(false);
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      let stop = () => {};
      stop = observe(node, rootMargin, threshold, (inView) => {
        if (inView) {
          setVisible(true);
          if (once) stop();
        } else if (!once) {
          setVisible(false);
        }
      });
      return stop;
    },
    [once, rootMargin, threshold],
  );

  const Component = as as 'div';
  const revealStyle = delay ? ({ '--reveal-delay': `${Math.round(delay * 1000)}ms`, ...style } as CSSProperties) : style;

  return (
    <Component
      ref={ref}
      className={cn('reveal', VARIANT_CLASS[variant], visible && 'is-visible', className)}
      style={revealStyle}
      {...props}
    />
  );
}
