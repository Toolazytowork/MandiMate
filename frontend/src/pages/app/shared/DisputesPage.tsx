import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { CircleCheck, Clock3, FilePlus2, Gavel, Scale, ShieldQuestion } from 'lucide-react';

import { PageHeader, QueryState, StatusBadge , useUiLanguage } from '@/components/domain';
import { Badge, Button, Dialog, Field, RadioCard, RadioCardGroup, SegmentedControl, Select, Sheet, Textarea, toast } from '@/components/ui';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { FormAlert } from '@/features/shared/components/FormAlert';
import { apiErrorMessage, applyFieldErrors } from '@/features/shared/forms';
import { useCreateDispute, useDisputes, useMyLots } from '@/features/shared/hooks';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Dispute, DisputeCategory, DisputeStatus } from '@/types/api';

const CATEGORIES: DisputeCategory[] = ['quantity', 'quality', 'payment', 'transport', 'other'];
type StatusFilter = 'all' | DisputeStatus;

export default function DisputesPage() {
  const { t } = useTranslation('shared');
  const [params, setParams] = useSearchParams();
  const presetLot = params.get('lot');
  const [raiseOpen, setRaiseOpen] = useState(Boolean(presetLot));
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Dispute | null>(null);
  const query = useDisputes({ status: filter === 'all' ? undefined : filter, limit: 100 });

  const closeRaise = (open: boolean) => {
    setRaiseOpen(open);
    if (!open && presetLot) {
      params.delete('lot');
      setParams(params, { replace: true });
    }
  };

  return (
    <div className="space-y-8">
      <Seo
        title={t('disputes.seoTitle', { defaultValue: 'Disputes' })}
        description={t('disputes.description', { defaultValue: 'Issues raised on your lots and how each one was resolved.' })}
        path="/app/disputes"
        noindex
      />
      <PageHeader
        eyebrow={t('disputes.eyebrow', { defaultValue: 'Fair dealing' })}
        title={t('disputes.title', { defaultValue: 'Disputes' })}
        description={t('disputes.description', { defaultValue: 'Issues raised on your lots and how each one was resolved.' })}
        actions={
          <Button leadingIcon={<FilePlus2 aria-hidden="true" strokeWidth={1.25} />} onClick={() => setRaiseOpen(true)}>
            {t('disputes.raise', { defaultValue: 'Raise a dispute' })}
          </Button>
        }
        divider
      />

      <div className="overflow-x-auto pb-1">
        <SegmentedControl<StatusFilter>
          label={t('disputes.filter', { defaultValue: 'Filter by status' })}
          value={filter}
          onValueChange={setFilter}
          size="sm"
          options={[
            { value: 'all', label: t('disputes.all', { defaultValue: 'All' }) },
            ...(['open', 'under_review', 'resolved', 'rejected'] as const).map((s) => ({
              value: s,
              label: t(`common:enums.disputeStatus.${s}`, { defaultValue: s.replace('_', ' ') }),
            })),
          ]}
        />
      </div>

      <QueryState
        query={query}
        skeleton="cards"
        empty={{
          icon: <Scale aria-hidden="true" strokeWidth={1.25} />,
          title: t('disputes.emptyTitle', { defaultValue: 'No disputes' }),
          description: t('disputes.emptyBody', {
            defaultValue: 'If a weight, grade, payment or pickup does not match what was agreed, raise it here. A coordinator reviews every case.',
          }),
          action: (
            <Button variant="secondary" onClick={() => setRaiseOpen(true)}>
              {t('disputes.raise', { defaultValue: 'Raise a dispute' })}
            </Button>
          ),
        }}
      >
        {(items) => (
          <StaggerGroup as="ul" className="grid gap-4 md:grid-cols-2">
            {items.map((d) => (
              <StaggerItem as="li" key={d.id}>
                <DisputeCard dispute={d} onOpen={() => setSelected(d)} />
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </QueryState>

      <RaiseDisputeDialog open={raiseOpen} onOpenChange={closeRaise} presetLotId={presetLot} />
      <DisputeSheet dispute={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DisputeCard({ dispute, onOpen }: { dispute: Dispute; onOpen: () => void }) {
  const { t } = useTranslation('shared');
  const lang = useUiLanguage();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full flex-col gap-4 rounded-card border border-line bg-paper p-6 text-start transition-colors duration-300 ease-luxe hover:border-ink/30 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink sm:p-7"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[13px] text-muted">
            {dispute.code} · {dispute.lot_code}
          </p>
          <p className="mt-2 font-display text-2xl font-bold leading-snug text-ink">
            {t(`common:enums.disputeCategory.${dispute.category}`, { defaultValue: dispute.category })}
          </p>
        </div>
        <StatusBadge kind="dispute" value={dispute.status} size="sm" />
      </div>
      <p className="line-clamp-3 text-sm font-normal leading-relaxed text-ink-2">{dispute.description}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span>
          {t('disputes.raisedBy', { defaultValue: 'Raised by {{name}}', name: dispute.raised_by_name })} ·{' '}
          <time dateTime={dispute.created_at}>{formatRelative(dispute.created_at, { locale: lang })}</time>
        </span>
        {dispute.resolution ? (
          <span className="inline-flex items-center gap-1 text-forest-700">
            <CircleCheck className="size-3.5" strokeWidth={1.25} aria-hidden="true" />
            {t('disputes.hasResolution', { defaultValue: 'Resolution recorded' })}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function DisputeSheet({ dispute, onClose }: { dispute: Dispute | null; onClose: () => void }) {
  const { t } = useTranslation('shared');
  const lang = useUiLanguage();
  const locale = lang;
  const steps = useMemo(() => {
    if (!dispute) return [];
    const done = dispute.status === 'resolved' || dispute.status === 'rejected';
    return [
      { key: 'raised', icon: FilePlus2, label: t('disputes.stepRaised', { defaultValue: 'Raised' }), at: dispute.created_at, active: true },
      {
        key: 'review',
        icon: Clock3,
        label: t('disputes.stepReview', { defaultValue: 'Under review by a coordinator' }),
        at: null,
        active: dispute.status !== 'open',
      },
      {
        key: 'closed',
        icon: Gavel,
        label:
          dispute.status === 'rejected'
            ? t('disputes.stepRejected', { defaultValue: 'Closed without change' })
            : t('disputes.stepResolved', { defaultValue: 'Resolved' }),
        at: dispute.resolved_at,
        active: done,
      },
    ];
  }, [dispute, t]);

  return (
    <Sheet
      open={dispute !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={dispute ? `${dispute.code}` : ''}
      description={
        dispute
          ? t('disputes.sheetDescription', {
              defaultValue: '{{category}} dispute on lot {{lot}}',
              category: t(`common:enums.disputeCategory.${dispute.category}`, { defaultValue: dispute.category }),
              lot: dispute.lot_code,
            })
          : undefined
      }
      size="lg"
    >
      {dispute ? (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="dispute" value={dispute.status} />
            <Badge tone="neutral">{t(`common:enums.role.${dispute.raised_by_role}`, { defaultValue: dispute.raised_by_role })}</Badge>
          </div>

          <section aria-labelledby="dispute-desc" className="space-y-2">
            <h3 id="dispute-desc" className="text-[13px] font-semibold text-muted">
              {t('disputes.whatHappened', { defaultValue: 'What happened' })}
            </h3>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{dispute.description}</p>
            <p className="text-xs text-muted">
              {dispute.raised_by_name} · {formatDateTime(dispute.created_at, { locale })}
            </p>
          </section>

          <ol className="relative space-y-5 border-s border-line ps-6">
            {steps.map((s) => (
              <li key={s.key} className="relative">
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -start-[28.5px] top-1.5 size-2 rounded-full border',
                    s.active ? 'border-ink bg-ink' : 'border-line bg-ivory',
                  )}
                />
                <p
                  className={cn(
                    'flex items-center gap-2 text-[13px] font-semibold',
                    s.active ? 'text-ink' : 'text-muted',
                  )}
                >
                  <s.icon aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                  {s.label}
                </p>
                {s.at ? <p className="text-xs text-muted">{formatDate(s.at, { locale })}</p> : null}
              </li>
            ))}
          </ol>

          <section
            aria-labelledby="dispute-resolution"
            className={cn('border-s py-1 ps-5', dispute.resolution ? 'border-forest-600' : 'border-line')}
          >
            <h3 id="dispute-resolution" className="flex items-center gap-2 font-display text-xl font-bold text-ink">
              {dispute.resolution ? <Gavel className="size-4 text-forest-700" strokeWidth={1.25} aria-hidden="true" /> : <ShieldQuestion className="size-4 text-muted" strokeWidth={1.25} aria-hidden="true" />}
              {t('disputes.resolution', { defaultValue: 'Resolution' })}
            </h3>
            {dispute.resolution ? (
              <>
                <p className="mt-2 whitespace-pre-line text-sm font-normal leading-relaxed text-ink-2">{dispute.resolution}</p>
                <p className="mt-3 text-xs text-muted">
                  {dispute.resolved_by_name ?? t('disputes.coordinator', { defaultValue: 'Coordinator' })}
                  {dispute.resolved_at ? ` · ${formatDateTime(dispute.resolved_at, { locale })}` : ''}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t('disputes.pendingResolution', {
                  defaultValue: 'A coordinator will review the delivery record, weights and quality report, then write the outcome here. Settlement for this lot is held until then.',
                })}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}

const raiseSchema = z.object({
  lot_id: z.string().min(1, 'Choose the lot this is about'),
  category: z.enum(['quantity', 'quality', 'payment', 'transport', 'other'], { message: 'Choose what went wrong' }),
  description: z.string().trim().min(20, 'Describe what happened in at least 20 characters').max(2000, 'Keep it under 2000 characters'),
});
type RaiseValues = z.infer<typeof raiseSchema>;

function RaiseDisputeDialog({
  open,
  onOpenChange,
  presetLotId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetLotId: string | null;
}) {
  const { t } = useTranslation('shared');
  const lots = useMyLots(open);
  const create = useCreateDispute();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, control, formState, setError, reset } = useForm<RaiseValues>({
    resolver: zodResolver(raiseSchema),
    defaultValues: { lot_id: presetLotId ?? '', category: undefined, description: '' },
  });

  const close = (next: boolean) => {
    if (create.isPending) return;
    if (!next) {
      reset({ lot_id: '', category: undefined, description: '' });
      setFormError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    create.mutate(values, {
      onSuccess: (dispute) => {
        toast.success(t('disputes.created', { defaultValue: 'Dispute {{code}} raised. A coordinator will review it.', code: dispute.code }));
        close(false);
      },
      onError: (error) => {
        const applied = applyFieldErrors(error, setError, { fields: ['lot_id', 'category', 'description'] });
        if (applied.length === 0) setFormError(apiErrorMessage(error, t));
      },
    });
  });

  const lotOptions = lots.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      dismissible={!create.isPending}
      size="lg"
      title={t('disputes.raiseTitle', { defaultValue: 'Raise a dispute' })}
      description={t('disputes.raiseBody', {
        defaultValue: 'Tell us what did not match the agreement. Settlement for the lot is paused while a coordinator reviews it.',
      })}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={create.isPending}>
            {t('common:actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" form="raise-dispute" loading={create.isPending}>
            {t('disputes.submit', { defaultValue: 'Raise dispute' })}
          </Button>
        </>
      }
    >
      <form id="raise-dispute" onSubmit={onSubmit} noValidate className="space-y-6">
        {formError ? <FormAlert title={t('disputes.createFailed', { defaultValue: 'Could not raise the dispute' })}>{formError}</FormAlert> : null}
        <Field
          label={t('disputes.lot', { defaultValue: 'Lot' })}
          error={formState.errors.lot_id?.message}
          hint={
            lots.isSuccess && lotOptions.length === 0
              ? t('disputes.noLots', { defaultValue: 'You are not part of any lot yet.' })
              : undefined
          }
          required
        >
          <Select
            {...register('lot_id')}
            disabled={lots.isPending}
            placeholder={lots.isPending ? t('disputes.loadingLots', { defaultValue: 'Loading your lots…' }) : t('disputes.chooseLot', { defaultValue: 'Choose a lot' })}
          >
            {lotOptions.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.code} · {lot.crop_name} · {t(`common:enums.lotStatus.${lot.status}`, { defaultValue: lot.status })}
              </option>
            ))}
          </Select>
        </Field>
        <Controller
          control={control}
          name="category"
          render={({ field, fieldState }) => (
            <RadioCardGroup
              label={t('disputes.category', { defaultValue: 'What went wrong?' })}
              name={field.name}
              value={field.value ?? ''}
              onValueChange={(v) => field.onChange(v as DisputeCategory)}
              error={fieldState.error?.message}
              columns={3}
              required
            >
              {CATEGORIES.map((c) => (
                <RadioCard key={c} value={c} title={t(`common:enums.disputeCategory.${c}`, { defaultValue: c })} />
              ))}
            </RadioCardGroup>
          )}
        />
        <Field
          label={t('disputes.descriptionLabel', { defaultValue: 'Describe it' })}
          hint={t('disputes.descriptionHint', { defaultValue: 'Include weights, dates and who you spoke to. Facts help us resolve it faster.' })}
          error={formState.errors.description?.message}
          required
        >
          <Textarea rows={5} {...register('description')} />
        </Field>
      </form>
    </Dialog>
  );
}
