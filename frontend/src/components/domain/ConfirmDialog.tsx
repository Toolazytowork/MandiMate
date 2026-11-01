import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, type ButtonVariant } from '@/components/ui';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Summary of what will happen (e.g. the net amount being accepted). */
  children?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** `danger` for destructive actions, `gold` for the one celebratory yes (accepting a deal). */
  tone?: 'primary' | 'danger' | 'gold';
  /**
   * Runs on confirm. When it returns a promise the dialog shows a spinner, cannot be dismissed while
   * it runs, closes when it resolves and stays open when it rejects (show the error in a toast).
   */
  onConfirm: () => unknown;
  /** External busy state (e.g. a mutation's `isPending`). */
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/** "Are you sure?" for irreversible steps: accept an offer, give consent, cancel a lot, mark a payout paid. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  onConfirm,
  loading = false,
  size = 'sm',
}: ConfirmDialogProps) {
  const { t } = useTranslation('domain');
  const [running, setRunning] = useState(false);
  const busy = loading || running;
  const variant: ButtonVariant = tone;

  const confirm = async () => {
    const result = onConfirm();
    if (!(result instanceof Promise)) {
      onOpenChange(false);
      return;
    }
    setRunning(true);
    try {
      await result;
      onOpenChange(false);
    } catch {
      // The caller reports the failure; keep the dialog open so the user can retry or cancel.
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={title}
      description={description}
      dismissible={!busy}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel ?? t('common:actions.cancel')}
          </Button>
          <Button variant={variant} onClick={() => void confirm()} loading={busy}>
            {confirmLabel ?? t('common:actions.confirm')}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
