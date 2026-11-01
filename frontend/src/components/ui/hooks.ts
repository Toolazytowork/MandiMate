import { useCallback, useEffect, useRef, useState, type Ref, type RefCallback, type RefObject } from 'react';

/** Controlled/uncontrolled state in one hook (value wins when defined). */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value: T | undefined;
  defaultValue: T;
  onChange?: (next: T) => void;
}): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [isControlled],
  );

  return [current, setValue];
}

/** Combine several refs (callback or object) into one callback ref. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as RefObject<T | null>).current = node;
    }
  };
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Rendered and not hidden by CSS (`checkVisibility` where supported, else a computed-style walk). */
function isVisible(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true });
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && isVisible(el),
  );
}

/* ── Layer stack: only the top-most overlay reacts to Escape / outside press ── */

const layerStack: symbol[] = [];

function useLayer(active: boolean): () => boolean {
  const idRef = useRef<symbol | null>(null);
  useEffect(() => {
    if (!active) return;
    const id = Symbol('layer');
    idRef.current = id;
    layerStack.push(id);
    return () => {
      const index = layerStack.indexOf(id);
      if (index !== -1) layerStack.splice(index, 1);
      idRef.current = null;
    };
  }, [active]);
  return useCallback(() => idRef.current !== null && layerStack[layerStack.length - 1] === idRef.current, []);
}

/* ── Scroll lock (ref-counted so nested overlays behave) ── */

let scrollLocks = 0;
let previousOverflow = '';
let previousPaddingRight = '';

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    if (scrollLocks === 0) {
      const scrollbarWidth = window.innerWidth - root.clientWidth;
      previousOverflow = root.style.overflow;
      previousPaddingRight = root.style.paddingRight;
      root.style.overflow = 'hidden';
      if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) {
        root.style.overflow = previousOverflow;
        root.style.paddingRight = previousPaddingRight;
      }
    };
  }, [active]);
}

interface OverlayOptions {
  /** Whether the overlay is currently interactive. */
  active: boolean;
  /** Element that contains the overlay's focusable content. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called on Escape and (when `outsideRefs` are given) on a press outside them. */
  onDismiss: (reason: 'escape' | 'outside') => void;
  /** Element to focus first; defaults to the first focusable child, then the container. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Move focus into the container on activation (components that place focus themselves pass false). */
  autoFocus?: boolean;
  /** Trap Tab inside the container (dialogs, sheets). */
  trapFocus?: boolean;
  /** Return focus to the previously focused element when deactivated. */
  restoreFocus?: boolean;
  /** Pressing outside every one of these elements dismisses the overlay. */
  outsideRefs?: RefObject<HTMLElement | null>[];
}

/**
 * Focus management + dismissal shared by Dialog, Sheet, DropdownMenu and the
 * marketing mobile menu: initial focus, Tab trap, Escape, outside press and
 * focus restoration — all scoped to the top-most layer.
 * Returns `isTopLayer()` for handlers that dismiss on their own (e.g. a backdrop).
 */
export function useOverlay({
  active,
  containerRef,
  onDismiss,
  initialFocusRef,
  autoFocus = true,
  trapFocus = true,
  restoreFocus = true,
  outsideRefs,
}: OverlayOptions): () => boolean {
  const isTopLayer = useLayer(active);
  const onDismissRef = useRef(onDismiss);
  const outsideRefsRef = useRef(outsideRefs);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    outsideRefsRef.current = outsideRefs;
  });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (autoFocus) {
      const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
      target.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismissRef.current('escape');
        return;
      }
      if (event.key !== 'Tab' || !trapFocus) return;
      const items = getFocusable(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = !container.contains(current);
      if (event.shiftKey && (current === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const refs = outsideRefsRef.current;
      if (!refs || !isTopLayer()) return;
      const node = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(node))) return;
      onDismissRef.current('outside');
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      if (restoreFocus && previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, autoFocus, containerRef, initialFocusRef, isTopLayer, restoreFocus, trapFocus]);

  return isTopLayer;
}
