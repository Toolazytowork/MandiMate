import { CheckCircle2, Eye, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatusBadge } from '@/components/domain';
import { Badge, Button, Field, Sheet, Textarea, toast } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { Dispute, DisputeUpdateRequest } from '@/types/api';

import { useUpdateDispute } from '../hooks';
import { errorMessage } from '../utils';

/** Dispute detail with the coordinator's moves: take under review, resolve or reject with a written resolution. */
export function DisputeSheet({ dispute, onClose }: { dispute: Dispute | null; onClose: () => void }) {
  const { t } = useTranslation('coordinatorOps');
  const update = useUpdateDispute();
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<DisputeUpdateRequest['status'] | null>(null);

  useEffect(() => {
    setResolution(dispute?.resolution ?? '');
    setError(null);
  }, [dispute?.id, dispute?.resolution]);

  const closed = dispute?.status === 'resolved' || dispute?.status === 'rejected';

  const act = (status: DisputeUpdateRequest['status']) => {
    if (!dispute) return;
    const text = resolution.trim();
    if (status !== 'under_review' && text.length < 10) {
      setError(t('disputes.resolutionRequired', { defaultValue: 'Write a resolution of at least 10 characters. Both sides will read it.' }));
      return;
    }
    setActing(status);
    update.mutate(
      { id: dispute.id, req: { status, resolution: status === 'under_review' ? text || null : text } },
      {
        onSuccess: () => {
          toast.success(
            status === 'under_review'
              ? t('disputes.toast.review', { defaultValue: '{{code}} is now under review', code: dispute.code })
              : status === 'resolved'
                ? t('disputes.toast.resolved', { defaultValue: '{{code}} resolved', code: dispute.code })
                : t('disputes.toast.rejected', { defaultValue: '{{code}} rejected', code: dispute.code }),
          );
          if (status !== 'under_review') onClose();
        },
        onError: (err) => {
          const fieldError = (err as { fieldErrors?: Record<string, string> }).fieldErrors?.resolution;
          if (fieldError) setError(fieldError);
          else toast.error(errorMessage(err));
        },
        onSettled: () => setActing(null),
      },
    );
  };

  return (
    <Sheet
      open={dispute !== null}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      dismissible={!update.isPending}
      title={dispute ? dispute.code : t('disputes.title', { defaultValue: 'Disputes' })}
      description={
        dispute
          ? t('disputes.raisedBy', {
              defaultValue: 'Raised by {{name}} ({{role}}) · {{date}}',
              name: dispute.raised_by_name,
              role: t(`common:enums.role.${dispute.raised_by_role}`, { defaultValue: dispute.raised_by_role }),
              date: formatDateTime(dispute.created_at),
            })
          : undefined
      }
      footer={
        dispute && !closed ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {dispute.status === 'open' ? (
              <Button variant="secondary" onClick={() => act('under_review')} loading={acting === 'under_review'} disabled={update.isPending} leadingIcon={<Eye strokeWidth={1.25} aria-hidden />}>
                {t('disputes.review', { defaultValue: 'Take under review' })}
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => act('rejected')} loading={acting === 'rejected'} disabled={update.isPending} leadingIcon={<XCircle strokeWidth={1.25} aria-hidden />}>
              {t('disputes.reject', { defaultValue: 'Reject' })}
            </Button>
            <Button onClick={() => act('resolved')} loading={acting === 'resolved'} disabled={update.isPending} leadingIcon={<CheckCircle2 strokeWidth={1.25} aria-hidden />}>
              {t('disputes.resolve', { defaultValue: 'Resolve' })}
            </Button>
          </div>
        ) : undefined
      }
    >
      {dispute ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="dispute" value={dispute.status} />
            <Badge tone="neutral">{t(`common:enums.disputeCategory.${dispute.category}`, { defaultValue: dispute.category })}</Badge>
          </div>

          <dl className="grid grid-cols-2 gap-4 rounded-card border border-line bg-parchment/40 p-5 text-small">
            <div>
              <dt className="eyebrow text-muted">{t('disputes.lot', { defaultValue: 'Lot' })}</dt>
              <dd className="mt-1">
                <Link to={`/app/coordinator/lots/${dispute.lot_id}`} className="link-luxe text-ink">
                  {dispute.lot_code}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="eyebrow text-muted">{t('disputes.settlement', { defaultValue: 'Settlement' })}</dt>
              <dd className="mt-1">
                {dispute.settlement_id ? (
                  <Link to={`/app/coordinator/settlements/${dispute.settlement_id}`} className="link-luxe text-ink">
                    {t('disputes.openSettlement', { defaultValue: 'Open settlement' })}
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
          </dl>

          <section className="space-y-2">
            <h3 className="eyebrow text-muted">{t('disputes.complaint', { defaultValue: 'What was reported' })}</h3>
            <p className="whitespace-pre-line font-display text-[1.125rem] leading-relaxed text-ink">{dispute.description}</p>
          </section>

          {closed ? (
            <section className="space-y-2 border-t border-line pt-5">
              <h3 className="eyebrow text-muted">{t('disputes.resolution', { defaultValue: 'Resolution' })}</h3>
              <p className="whitespace-pre-line text-body text-ink">{dispute.resolution ?? '—'}</p>
              <p className="text-micro text-muted">
                {dispute.resolved_by_name ?? ''}
                {dispute.resolved_at ? ` · ${formatDateTime(dispute.resolved_at)}` : ''}
              </p>
            </section>
          ) : (
            <Field
              label={t('disputes.resolution', { defaultValue: 'Resolution' })}
              hint={t('disputes.resolutionHint', { defaultValue: 'Required to resolve or reject. Shared with everyone on the lot.' })}
              error={error ?? undefined}
            >
              <Textarea
                value={resolution}
                onChange={(event) => {
                  setResolution(event.target.value);
                  if (error) setError(null);
                }}
                rows={5}
                maxLength={2000}
              />
            </Field>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
