import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Portal } from './Portal';

type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link). It receives `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  placement?: Placement;
  /** Hover delay in ms (focus opens immediately). */
  delay?: number;
  className?: string;
}

const GAP = 8;
const VIEWPORT_MARGIN = 8;

function position(anchor: DOMRect, tip: DOMRect, preferred: Placement): { top: number; left: number; placement: Placement } {
  const fits: Record<Placement, boolean> = {
    top: anchor.top - tip.height - GAP >= VIEWPORT_MARGIN,
    bottom: anchor.bottom + tip.height + GAP <= window.innerHeight - VIEWPORT_MARGIN,
    left: anchor.left - tip.width - GAP >= VIEWPORT_MARGIN,
    right: anchor.right + tip.width + GAP <= window.innerWidth - VIEWPORT_MARGIN,
  };
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const placement = fits[preferred] || !fits[opposite[preferred]] ? preferred : opposite[preferred];

  let top: number;
  let left: number;
  if (placement === 'top' || placement === 'bottom') {
    top = placement === 'top' ? anchor.top - tip.height - GAP : anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - tip.width / 2;
  } else {
    top = anchor.top + anchor.height / 2 - tip.height / 2;
    left = placement === 'left' ? anchor.left - tip.width - GAP : anchor.right + GAP;
  }
  const maxLeft = window.innerWidth - tip.width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - tip.height - VIEWPORT_MARGIN;
  return {
    top: Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop),
    left: Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft),
    placement,
  };
}

/** Small ink label on hover/focus. Not shown for touch input; never put essential info only here. */
export function Tooltip({ content, children, placement = 'top', delay = 120, className }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: Placement } | null>(null);

  const show = (immediate: boolean) => {
    window.clearTimeout(timer.current);
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setCoords(null);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    setCoords(position(anchorRef.current.getBoundingClientRect(), tipRef.current.getBoundingClientRect(), placement));
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined,
      })
    : children;

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show(false);
        }}
        onPointerLeave={hide}
        onFocus={(event) => {
          if ((event.target as HTMLElement).matches(':focus-visible')) show(true);
        }}
        onBlur={hide}
      >
        {trigger}
      </span>
      {open ? (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{ top: coords?.top ?? 0, left: coords?.left ?? 0 }}
            className={cn(
              'pointer-events-none fixed z-[70] max-w-64 rounded-sm bg-forest-900 px-3 py-2 text-xs leading-snug text-ivory shadow-luxe-sm',
              coords ? 'animate-pop-in' : 'invisible',
              className,
            )}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
