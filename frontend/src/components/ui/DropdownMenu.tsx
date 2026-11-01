import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { DURATION, EASE_LUXE } from '@/components/motion/tokens';
import { Portal } from './Portal';
import { useOverlay } from './hooks';

interface MenuContextValue {
  close: (restoreFocus?: boolean) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu(component: string): MenuContextValue {
  const context = useContext(MenuContext);
  if (!context) throw new Error(`${component} must be rendered inside <DropdownMenu>.`);
  return context;
}

export interface DropdownTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface DropdownMenuProps {
  /** Render the trigger and spread the provided props onto a button (e.g. `<IconButton {...props} />`). */
  trigger: (props: DropdownTriggerProps) => ReactNode;
  /** Accessible name for the menu; defaults to the trigger's name. */
  label?: string;
  align?: 'start' | 'end';
  /** Menu width class. */
  widthClassName?: string;
  className?: string;
  children: ReactNode;
}

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';
const GAP = 8;
const VIEWPORT_MARGIN = 8;

/** Accessible action menu: arrow-key roving focus, typeahead, Escape/Tab/outside press close. */
export function DropdownMenu({ trigger, label, align = 'end', widthClassName = 'w-60', className, children }: DropdownMenuProps) {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; origin: string } | null>(null);
  const restoreRef = useRef(true);

  const close = (restoreFocus = true) => {
    restoreRef.current = restoreFocus;
    setOpen(false);
  };

  useOverlay({
    active: open,
    containerRef: menuRef,
    // Escape returns focus to the trigger; a press elsewhere leaves focus where the user put it.
    onDismiss: (reason) => close(reason === 'escape'),
    autoFocus: false,
    trapFocus: false,
    restoreFocus: false,
    outsideRefs: [menuRef, triggerRef],
  });

  // Position (and focus an item) before the first paint; the coords re-render also lands pre-paint.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const below = anchor.bottom + GAP + height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = below ? anchor.bottom + GAP : Math.max(VIEWPORT_MARGIN, anchor.top - GAP - height);
    const rawLeft = align === 'end' ? anchor.right - width : anchor.left;
    const left = Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
    setCoords({ top, left, origin: `${align === 'end' ? 'right' : 'left'} ${below ? 'top' : 'bottom'}` });
    const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
    (focusLast ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
  }, [open, align, focusLast]);

  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (restoreRef.current) triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  const openMenu = (last: boolean) => {
    restoreRef.current = true;
    setFocusLast(last);
    setOpen(true);
  };

  const typeahead = useRef({ query: '', timer: 0 });

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(index + 1);
      case 'ArrowUp':
        return move(index - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(items.length - 1);
      case 'Tab':
        event.preventDefault();
        close(true);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const state = typeahead.current;
          window.clearTimeout(state.timer);
          state.query += event.key.toLowerCase();
          state.timer = window.setTimeout(() => {
            state.query = '';
          }, 500);
          const match = items.find((item) => item.textContent?.trim().toLowerCase().startsWith(state.query));
          match?.focus();
        }
    }
  };

  return (
    <MenuContext.Provider value={{ close }}>
      {trigger({
        ref: triggerRef,
        id: triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: () => (open ? close(true) : openMenu(false)),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(event.key === 'ArrowUp');
          }
        },
      })}
      <Portal>
        <AnimatePresence>
          {open ? (
            <motion.div
              key="menu"
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-labelledby={label ? undefined : triggerId}
              aria-label={label}
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              style={{ top: coords?.top ?? 0, left: coords?.left ?? 0, transformOrigin: coords?.origin }}
              initial={{ opacity: 0, scale: 1, y: -2 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1, y: 0, transition: { duration: 0.12 } }}
              transition={{ duration: DURATION.ui, ease: EASE_LUXE }}
              className={cn(
                'fixed z-[60] max-h-[min(70dvh,480px)] overflow-y-auto rounded-sm border border-line bg-paper p-1 text-ink shadow-luxe outline-none',
                widthClassName,
                className,
              )}
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Portal>
    </MenuContext.Provider>
  );
}

const ITEM_CLASSES = cn(
  'flex min-h-10 w-full select-none items-center gap-3 rounded-md px-3 py-2 text-start text-sm text-ink outline-none transition-colors duration-150',
  'hover:bg-parchment focus-visible:bg-parchment focus-visible:outline-none',
  'aria-disabled:pointer-events-none aria-disabled:opacity-45',
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted [&_svg]:stroke-[1.25]",
);

const TONES = {
  default: '',
  danger: 'text-danger-ink hover:bg-danger/[0.07] focus-visible:bg-danger/[0.07] [&_svg]:text-danger',
} as const;

export interface DropdownMenuItemProps extends Omit<ComponentProps<'button'>, 'onSelect'> {
  icon?: ReactNode;
  /** Right-aligned hint, e.g. a shortcut. */
  hint?: ReactNode;
  tone?: keyof typeof TONES;
  onSelect?: () => void;
}

export function DropdownMenuItem({ icon, hint, tone = 'default', onSelect, disabled, className, children, ...props }: DropdownMenuItemProps) {
  const { close } = useMenu('DropdownMenuItem');
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        close(true);
        onSelect?.();
      }}
      className={cn(ITEM_CLASSES, TONES[tone], className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="ms-auto text-xs text-muted">{hint}</span> : null}
    </button>
  );
}

export interface DropdownMenuLinkItemProps extends ComponentProps<typeof Link> {
  icon?: ReactNode;
}

export function DropdownMenuLinkItem({ icon, className, children, onClick, ...props }: DropdownMenuLinkItemProps) {
  const { close } = useMenu('DropdownMenuLinkItem');
  return (
    <Link
      role="menuitem"
      tabIndex={-1}
      onClick={(event) => {
        close(false);
        onClick?.(event);
      }}
      className={cn(ITEM_CLASSES, className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<'div'>) {
  return <div role="presentation" className={cn('px-3 pb-1.5 pt-2.5 text-[13px] font-semibold text-muted', className)} {...props} />;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('hairline mx-2 my-1.5', className)} />;
}
