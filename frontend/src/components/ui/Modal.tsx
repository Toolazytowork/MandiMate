import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useIsPresent, type TargetAndTransition } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DURATION, EASE_LUXE } from '@/components/motion/tokens';
import { IconButton } from './IconButton';
import { Portal } from './Portal';
import { useOverlay, useScrollLock } from './hooks';

export interface ModalBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions row, pinned to the bottom. */
  footer?: ReactNode;
  /** Keep the title for assistive tech but don't show it. */
  hideTitle?: boolean;
  /** When false, Escape and backdrop presses don't close (e.g. while a request is in flight). */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
}

interface ModalFrameProps extends ModalBaseProps {
  surface: 'light' | 'dark';
  containerClassName: string;
  panelClassName: string;
  motionFrom: TargetAndTransition;
  motionExit: TargetAndTransition;
}

/** Shared engine for Dialog and Sheet: portal, presence animation, focus trap, scroll lock. */
export function ModalFrame(props: ModalFrameProps) {
  return (
    <Portal>
      <AnimatePresence>{props.open ? <ModalLayer key="modal" {...props} /> : null}</AnimatePresence>
    </Portal>
  );
}

function ModalLayer({
  onOpenChange,
  title,
  description,
  children,
  footer,
  hideTitle = false,
  dismissible = true,
  initialFocusRef,
  className,
  bodyClassName,
  surface,
  containerClassName,
  panelClassName,
  motionFrom,
  motionExit,
}: ModalFrameProps) {
  const { t } = useTranslation('common');
  const isPresent = useIsPresent();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = () => onOpenChange(false);
  const dark = surface === 'dark';

  const isTopLayer = useOverlay({
    active: isPresent,
    containerRef: panelRef,
    initialFocusRef,
    onDismiss: () => {
      if (dismissible) close();
    },
  });
  useScrollLock(isPresent);

  return (
    <div className={cn('fixed inset-0 z-50 flex', containerClassName)}>
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-forest-950/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.overlay, ease: EASE_LUXE }}
        onPointerDown={() => {
          if (dismissible && isTopLayer()) close();
        }}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex flex-col overflow-hidden shadow-luxe-lg outline-none',
          dark ? 'surface-dark bg-forest-950' : 'border-line bg-paper text-ink',
          panelClassName,
          className,
        )}
        initial={motionFrom}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        exit={motionExit}
        transition={{ duration: DURATION.overlay, ease: EASE_LUXE }}
      >
        <header className={cn('shrink-0 px-6 pt-6 pe-16 sm:px-7 sm:pe-16', hideTitle && 'sr-only')}>
          <h2 id={titleId} className="font-display text-h2 font-bold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-(--fg-muted)">
              {description}
            </p>
          ) : null}
        </header>
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 sm:px-7', bodyClassName)}>
          {children}
        </div>
        {footer ? (
          <footer
            className={cn(
              'flex shrink-0 flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7',
              dark ? 'border-ivory/10' : 'border-line',
            )}
          >
            {footer}
          </footer>
        ) : null}
        {/* Last in DOM order so focus starts on the content; visually pinned top-right. */}
        <IconButton
          label={t('a11y.close', { defaultValue: 'Close' })}
          icon={<X strokeWidth={1.25} />}
          size="sm"
          onClick={close}
          className={cn('absolute end-3 top-3 z-10 sm:end-4 sm:top-4', dark ? 'text-ivory/80' : 'text-ink/70')}
        />
      </motion.div>
    </div>
  );
}
