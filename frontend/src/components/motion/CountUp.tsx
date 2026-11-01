import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { EASE_LUXE } from './tokens';

export interface CountUpProps {
  value: number;
  /** Formats every frame, e.g. `(n) => formatINR(n)`. Defaults to Indian digit grouping. */
  format?: (value: number) => string;
  /** Fraction digits for the default formatter. */
  decimals?: number;
  /** Seconds. */
  duration?: number;
  className?: string;
}

/**
 * A number that counts up when it scrolls into view.
 * The server (and any visitor who already sees it on load) gets the final value: counting only
 * starts from zero for numbers that are still off-screen after hydration, so nothing flickers.
 * Later `value` changes animate from the number currently shown.
 */
export function CountUp({ value, format, decimals = 0, duration = 1.6, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const shown = useRef(value);
  const target = useRef(value);
  const waitingForView = useRef(false);
  const controls = useRef<ReturnType<typeof animate> | null>(null);

  const formatValue = format ?? ((n: number) => formatNumber(n, { decimals }));

  const run = (from: number, to: number) => {
    controls.current?.stop();
    controls.current = animate(from, to, {
      duration,
      ease: EASE_LUXE,
      onUpdate: (latest) => {
        shown.current = latest;
        setDisplay(latest);
      },
    });
  };

  // First view: arm the count-up only if the number starts off-screen.
  useEffect(() => {
    const node = ref.current;
    if (!node || reduceMotion || typeof IntersectionObserver === 'undefined') return;
    let first = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (first) {
          first = false;
          if (entry.isIntersecting) {
            observer.disconnect();
            return;
          }
          waitingForView.current = true;
          shown.current = 0;
          setDisplay(0);
          return;
        }
        if (entry.isIntersecting && waitingForView.current) {
          waitingForView.current = false;
          observer.disconnect();
          run(0, target.current);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      controls.current?.stop();
    };
    // Runs once per mount (value changes are handled by the next effect).
  }, [reduceMotion]);

  // Subsequent value changes.
  useEffect(() => {
    if (target.current === value) return;
    target.current = value;
    if (waitingForView.current) return;
    if (reduceMotion) {
      shown.current = value;
      setDisplay(value);
      return;
    }
    run(shown.current, value);
  }, [value, reduceMotion]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {formatValue(display)}
    </span>
  );
}
