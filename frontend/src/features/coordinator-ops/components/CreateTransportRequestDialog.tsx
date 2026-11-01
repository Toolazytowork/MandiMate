import { Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Quantity, TransportPlanSummary } from '@/components/domain';
import { Button, Dialog, Field, Skeleton, Textarea, toast } from '@/components/ui';
import { errorMessage } from '@/features/coordinator/utils';
import { formatDate } from '@/lib/format';
import type { Lot } from '@/types/api';

import { useCreateTransportRequest, useTransportPlan } from '../hooks';

export interface CreateTransportRequestDialogProps {
  lot: Lot | null;
  onOpenChange: (open: boolean) => void;
}

/** Previews the pooled pickup route and vehicle, then opens the request to transporters for quotes. */
export function CreateTransportRequestDialog({ lot, onOpenChange }: CreateTransportRequestDialogProps) {
  const { t } = useTranslation('coordinatorOps');
  const open = lot !== null;
  const [notes, setNotes] = useState('');
  const plan = useTransportPlan(lot?.id ?? '', open);
  const create = useCreateTransportRequest();

  useEffect(() => {
    if (open) setNotes('');
  }, [open, lot?.id]);

  const submit = () => {
    if (!lot) return;
    create.mutate(
      { lotId: lot.id, notes: notes.trim() || null },
      {
        onSuccess: () => {
          toast.success(t('transport.create.success', { defaultValue: 'Transport request opened for {{code}}', code: lot.code }));
          onOpenChange(false);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      dismissible={!create.isPending}
      title={t('transport.create.title', { defaultValue: 'Request transport for {{code}}', code: lot?.code ?? '' })}
      description={
        lot ? (
          <span>
            {lot.crop_name} · <Quantity kg={lot.total_quantity_kg} /> ·{' '}
            {t('transport.create.pickup', { defaultValue: 'pickup {{date}}', date: formatDate(lot.pickup_date) })}
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={plan.isError && !plan.data} leadingIcon={<Truck strokeWidth={1.25} aria-hidden />}>
            {t('transport.create.submit', { defaultValue: 'Open for quotes' })}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {plan.isPending ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ) : plan.isError ? (
          <p role="alert" className="rounded-card border border-warning/30 bg-paper p-4 text-small text-warning-ink">
            {t('transport.create.planError', {
              defaultValue: 'The route preview is unavailable: {{message}}. You can still open the request.',
              message: errorMessage(plan.error),
            })}
          </p>
        ) : plan.data ? (
          <TransportPlanSummary plan={plan.data} />
        ) : null}

        <Field
          label={t('transport.create.notes', { defaultValue: 'Notes for transporters' })}
          hint={t('transport.create.notesHint', { defaultValue: 'Loading windows, road access, crates or tarpaulin needs.' })}
          optional
        >
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={1000} />
        </Field>
      </div>
    </Dialog>
  );
}
