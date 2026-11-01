import { Toaster as SonnerToaster } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { Spinner } from './Spinner';

/**
 * App-wide toast host (sonner), styled ivory/forest. Render once near the root;
 * trigger toasts with `toast.success(...)` etc. from `@/components/ui`.
 * Sonner announces toasts through its own polite live region.
 */
export function Toaster() {
  const { t } = useTranslation('common');
  return (
    <SonnerToaster
      position="bottom-right"
      theme="light"
      gap={10}
      offset={24}
      mobileOffset={16}
      visibleToasts={4}
      containerAriaLabel={t('a11y.notifications', { defaultValue: 'Notifications' })}
      icons={{
        success: <CircleCheck aria-hidden="true" strokeWidth={1.25} className="size-[18px] text-success" />,
        error: <CircleX aria-hidden="true" strokeWidth={1.25} className="size-[18px] text-danger" />,
        warning: <TriangleAlert aria-hidden="true" strokeWidth={1.25} className="size-[18px] text-warning" />,
        info: <Info aria-hidden="true" strokeWidth={1.25} className="size-[18px] text-info" />,
        loading: <Spinner size="sm" className="text-forest-700" />,
        close: <X aria-hidden="true" strokeWidth={1.25} className="size-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t('a11y.close', { defaultValue: 'Close' }),
        classNames: {
          toast:
            'group/toast pointer-events-auto relative flex w-full items-start gap-3 rounded-sm border border-line bg-paper py-3.5 ps-4 pe-10 text-sm text-ink shadow-luxe data-[expanded=false]:data-[front=false]:*:opacity-0',
          icon: 'mt-px flex shrink-0 items-center',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'font-medium leading-snug',
          description: 'text-[13px] leading-snug text-muted',
          actionButton:
            'ms-2 inline-flex h-8 shrink-0 items-center self-center rounded-sm bg-forest-900 px-3.5 text-[13px] font-semibold text-ivory transition-colors hover:bg-forest-800',
          cancelButton:
            'ms-1 inline-flex h-8 shrink-0 items-center self-center rounded-sm px-3 text-[13px] font-semibold text-muted transition-colors hover:bg-ink/5 hover:text-ink',
          closeButton:
            'absolute end-2.5 top-2.5 grid size-7 place-items-center rounded-sm text-muted transition-colors hover:bg-ink/5 hover:text-ink',
          error: 'border-danger/25',
          warning: 'border-warning/30',
          success: 'border-success/25',
        },
      }}
      closeButton
    />
  );
}
