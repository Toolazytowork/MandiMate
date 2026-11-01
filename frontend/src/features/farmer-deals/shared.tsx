/**
 * Shared pieces for the farmer's deal screens (offers, lots, sales, earnings, buyer demand).
 * Server state comes from `@/features/farmer/hooks`; this file only adds deal-specific UI.
 */
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button, Dialog, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { CertaintyBadge, Money, Quantity } from '@/components/domain';
import { useErrorToast, useJoinLot } from '@/features/farmer/hooks';
import { compatibleHarvests } from '@/features/farmer/lib';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatKg } from '@/lib/format';
import type { Harvest, Lot, NetProceeds } from '@/types/api';

export const FARMER_BASE = '/app/farmer';

/** NET first, gross beside it, always with the certainty marker. */
export function NetSummary({
  proceeds,
  loading,
  label,
  className,
  tone = 'light',
}: {
  proceeds: NetProceeds | undefined;
  loading?: boolean;
  label?: ReactNode;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  const { t } = useTranslation('farmerDeals');
  if (loading) return <Skeleton className={cn('h-14 w-full rounded-sm', className)} />;
  if (!proceeds) {
    return (
      <p className={cn('text-sm', tone === 'dark' ? 'text-ivory/70' : 'text-muted', className)}>
        {t('net.unavailable', { defaultValue: 'Your take-home is being worked out.' })}
      </p>
    );
  }
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-2', className)}>
      <div className="min-w-0">
        <p className={cn('text-[13px] font-semibold', tone === 'dark' ? 'text-gold-400' : 'text-gold-700')}>
          {label ?? t('net.youKeep', { defaultValue: 'You take home' })}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <Money value={proceeds.net_amount} size="lg" className={cn('font-display font-bold', tone === 'dark' ? 'text-ivory' : 'text-ink')} />
          <span className={cn('text-sm', tone === 'dark' ? 'text-ivory/70' : 'text-muted')}>
            <Money value={proceeds.net_per_kg} perKg size="sm" tone="muted" />
          </span>
        </div>
      </div>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <CertaintyBadge certainty={proceeds.confidence} withTooltip />
        <p className={cn('text-xs', tone === 'dark' ? 'text-ivory/65' : 'text-muted')}>
          {t('net.grossBeside', { defaultValue: 'Gross' })}{' '}
          <Money value={proceeds.gross_amount} size="sm" tone="muted" /> ·{' '}
          {t('net.costs', { defaultValue: 'costs' })} <Money value={-proceeds.total_deductions} size="sm" />
        </p>
      </div>
    </div>
  );
}

/** "Section heading + count" used for the grouped lists. */
export function GroupHeading({ title, count, description, id }: { title: ReactNode; count: number; description?: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line pb-5">
      <div className="flex items-baseline gap-3">
        <h2 id={id} className="font-display text-h2 font-bold text-ink">
          {title}
        </h2>
        <span className="font-display text-lg not-italic text-gold-700 tabular-nums">{String(count).padStart(2, '0')}</span>
      </div>
      {description ? <p className="max-w-2xl text-sm font-normal leading-relaxed text-ink-2">{description}</p> : null}
    </div>
  );
}

/** Quiet labelled fact. */
export function Fact({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="min-w-0 text-[15px] text-ink">{children}</dd>
    </div>
  );
}

/* ───────────────────────────── Join a lot ──────────────────────────── */

export function JoinLotDialog({
  lot,
  harvests,
  open,
  onOpenChange,
}: {
  lot: Lot;
  harvests: readonly Harvest[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('farmerDeals');
  const navigate = useNavigate();
  const join = useJoinLot();
  const onError = useErrorToast();
  const options = useMemo(() => compatibleHarvests(lot, harvests), [lot, harvests]);
  const room = Math.max(0, lot.target_quantity_kg - lot.total_quantity_kg);

  const schema = useMemo(
    () =>
      z.object({
        harvest_id: z.string().min(1, t('join.pickHarvest', { defaultValue: 'Choose a harvest.' })),
        quantity_kg: z
          .number({ error: t('join.kgRequired', { defaultValue: 'Enter how many kg.' }) })
          .positive(t('join.kgPositive', { defaultValue: 'Enter more than 0 kg.' })),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { harvest_id: options[0]?.id ?? '', quantity_kg: options[0] ? Math.min(options[0].available_kg, room || options[0].available_kg) : undefined },
  });
  const harvestId = form.watch('harvest_id');
  const chosen = options.find((harvest) => harvest.id === harvestId);

  const submit = form.handleSubmit((values) => {
    if (chosen && values.quantity_kg > chosen.available_kg) {
      form.setError('quantity_kg', {
        message: t('join.kgTooMuch', { defaultValue: 'You have only {{kg}} free in this harvest.', kg: formatKg(chosen.available_kg) }),
      });
      return;
    }
    join.mutate(
      { lotId: lot.id, req: { harvest_id: values.harvest_id, quantity_kg: values.quantity_kg } },
      {
        onSuccess: () => {
          toast.success(t('join.done', { defaultValue: 'You joined lot {{code}}.', code: lot.code }));
          onOpenChange(false);
          void navigate(`${FARMER_BASE}/lots/${lot.id}`);
        },
        onError: (error) => {
          if (isApiError(error)) {
            for (const [field, message] of Object.entries(error.fieldErrors)) {
              if (field === 'quantity_kg' || field === 'harvest_id') form.setError(field, { message });
            }
          }
          onError(error);
        },
      },
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!join.isPending}
      title={t('join.title', { defaultValue: 'Join lot {{code}}', code: lot.code })}
      description={t('join.description', {
        defaultValue: '{{crop}}, grade {{grade}}, pickup on {{date}} at {{place}}. You can still say no before any deal is agreed.',
        crop: lot.crop_name,
        grade: lot.grade,
        date: formatDate(lot.pickup_date),
        place: lot.collection_point_name,
      })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={join.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" form="join-lot-form" loading={join.isPending} disabled={options.length === 0}>
            {t('join.submit', { defaultValue: 'Join this lot' })}
          </Button>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="text-sm text-muted">
          {t('join.noHarvest', { defaultValue: 'None of your listed harvests match this lot’s crop, grade and pickup date.' })}
        </p>
      ) : (
        <form id="join-lot-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
          <Field label={t('join.harvest', { defaultValue: 'Which harvest?' })} error={form.formState.errors.harvest_id?.message} required>
            <Select {...form.register('harvest_id')}>
              {options.map((harvest) => (
                <option key={harvest.id} value={harvest.id}>
                  {t('join.harvestOption', {
                    defaultValue: '{{crop}} · grade {{grade}} · {{kg}} free · ready {{date}}',
                    crop: harvest.crop_name,
                    grade: harvest.grade,
                    kg: formatKg(harvest.available_kg),
                    date: formatDate(harvest.available_from),
                  })}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('join.kg', { defaultValue: 'How many kg?' })}
            hint={
              chosen
                ? t('join.kgHint', {
                    defaultValue: 'Up to {{kg}} free. The lot still needs {{room}}.',
                    kg: formatKg(chosen.available_kg),
                    room: formatKg(room),
                  })
                : undefined
            }
            error={form.formState.errors.quantity_kg?.message}
            required
          >
            <Input type="number" inputMode="decimal" min={1} step="any" {...form.register('quantity_kg', { valueAsNumber: true })} />
          </Field>
          {chosen?.grade === 'ungraded' ? (
            <p className="border-s border-gold-400 py-1 ps-4 text-sm text-ink-2">
              {t('join.ungraded', { defaultValue: 'Your harvest is not graded yet. It will be checked before pickup.' })}
            </p>
          ) : null}
        </form>
      )}
    </Dialog>
  );
}

/** "12,400 kg of 15,000 kg" with a hairline bar. */
export function FillMeter({ total, target }: { total: number; target: number }) {
  const { t } = useTranslation('farmerDeals');
  const pct = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink">
          <Quantity kg={total} /> <span className="text-muted">{t('lots.ofTarget', { defaultValue: 'of {{kg}}', kg: formatKg(target) })}</span>
        </span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <div
        className="h-0.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('lots.filled', { defaultValue: 'Lot filled' })}
      >
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
