import { createContext, useContext, useId, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { DURATION, EASE_LUXE } from '@/components/motion/tokens';
import { useControllableState } from './hooks';

interface TabsContextValue {
  baseId: string;
  value: string;
  setValue: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`${component} must be rendered inside <Tabs>.`);
  return context;
}

const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface TabsProps {
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
}

/** WAI-ARIA tabs with automatic activation, roving focus and a 1 px green underline for the active tab. */
export function Tabs({ value, defaultValue, onValueChange, className, children }: TabsProps) {
  const baseId = useId();
  const [current, setCurrent] = useControllableState({ value, defaultValue, onChange: onValueChange });
  return (
    <TabsContext.Provider value={{ baseId, value: current, setValue: setCurrent }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends ComponentProps<'div'> {
  /** Accessible name for the tab list. */
  label: string;
}

export function TabsList({ label, className, children, ...props }: TabsListProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        'no-scrollbar relative -mb-px flex gap-6 overflow-x-auto border-b border-(--hairline) sm:gap-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends Omit<ComponentProps<'button'>, 'value'> {
  value: string;
  /** Optional count shown as quiet tabular figures. */
  count?: number;
}

export function TabsTrigger({ value, count, className, children, disabled, ...props }: TabsTriggerProps) {
  const { baseId, value: current, setValue } = useTabs('TabsTrigger');
  const selected = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${slug(value)}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${slug(value)}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        'relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-semibold transition-colors duration-300',
        selected ? 'text-current' : 'text-(--fg-muted) hover:text-current',
        'disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-offset-[-2px]',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            'font-display text-[13px] not-italic tracking-normal tabular-nums transition-colors',
            selected ? 'text-gold-700' : 'opacity-70',
          )}
        >
          {count}
        </span>
      ) : null}
      {selected ? (
        <motion.span
          layoutId={`${baseId}-indicator`}
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-px bg-gold-700"
          transition={{ duration: DURATION.ui + 0.1, ease: EASE_LUXE }}
        />
      ) : null}
    </button>
  );
}

export interface TabsContentProps extends ComponentProps<'div'> {
  value: string;
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const { baseId, value: current } = useTabs('TabsContent');
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${slug(value)}`}
      aria-labelledby={`${baseId}-tab-${slug(value)}`}
      tabIndex={0}
      className={cn('animate-fade-in pt-6 focus-visible:outline-offset-4', className)}
      {...props}
    />
  );
}
