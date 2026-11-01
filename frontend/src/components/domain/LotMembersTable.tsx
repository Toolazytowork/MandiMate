import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import type { LotMember } from '@/types/api';
import { DataTable, type DataTableColumn } from './DataTable';
import { Quantity } from './Money';
import { QualityBadge } from './QualityBadge';
import { StatusBadge } from './StatusBadge';


export interface LotMembersTableProps {
  members: readonly LotMember[];
  /** Show delivered / accepted / rejected columns; defaults to whether any delivery is recorded. */
  showDelivery?: boolean;
  /** Show the consent column (default true). */
  showConsent?: boolean;
  /** Per-member actions (e.g. assisted consent for coordinators). */
  renderActions?: (member: LotMember) => ReactNode;
  loading?: boolean;
  caption?: ReactNode;
  className?: string;
}

/**
 * The farmers in a pooled lot. Names arrive already masked by the API for viewers who may not see
 * them in full; the viewer's own row is highlighted. Totals count only members who have not declined.
 */
export function LotMembersTable({
  members,
  showDelivery,
  showConsent = true,
  renderActions,
  loading = false,
  caption,
  className,
}: LotMembersTableProps) {
  const { t } = useTranslation('domain');
  const delivery = showDelivery ?? members.some((member) => member.delivered_kg !== null);
  const active = members.filter((member) => member.consent_status !== 'declined');
  const sum = (pick: (member: LotMember) => number | null) =>
    active.reduce((total, member) => total + (pick(member) ?? 0), 0);

  const columns: DataTableColumn<LotMember>[] = [
    {
      id: 'farmer',
      header: t('common:labels.farmer'),
      sortValue: (member) => member.farmer_name,
      cell: (member) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={member.farmer_name} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2.5 text-ink">
              <span className="truncate">{member.farmer_name}</span>
              {member.is_mine ? (
                <span className="text-[13px] font-semibold text-gold-700">{t('consent.you')}</span>
              ) : null}
            </span>
            {member.village ? <span className="truncate text-xs text-muted sm:hidden">{member.village}</span> : null}
          </span>
        </span>
      ),
      footer: <span className="text-[13px] font-semibold text-muted">{t('members.total', { count: active.length })}</span>,
    },
    {
      id: 'village',
      header: t('common:labels.village'),
      hideBelow: 'sm',
      sortValue: (member) => member.village,
      cell: (member) => <span className="text-ink/80">{member.village ?? '—'}</span>,
    },
    {
      id: 'distance',
      header: t('common:labels.distance'),
      numeric: true,
      hideBelow: 'md',
      sortValue: (member) => member.distance_km,
      cell: (member) =>
        member.distance_km === null ? (
          <span className="text-muted">—</span>
        ) : (
          t('common:units.kmValue', { value: formatNumber(member.distance_km, { maxDecimals: 1 }) })
        ),
    },
    {
      id: 'quantity',
      header: t('common:labels.quantity'),
      numeric: true,
      sortFirst: 'desc',
      sortValue: (member) => member.quantity_kg,
      cell: (member) => <Quantity kg={member.quantity_kg} size="sm" />,
      footer: <Quantity kg={sum((member) => member.quantity_kg)} size="sm" className="font-medium" />,
    },
    {
      id: 'quality',
      header: t('common:labels.quality'),
      hideBelow: 'lg',
      cell: (member) => <QualityBadge status={member.harvest_quality_status} />,
    },
  ];

  if (showConsent) {
    columns.push({
      id: 'consent',
      header: t('members.consent'),
      sortValue: (member) => member.consent_status,
      cell: (member) => <StatusBadge kind="consent" value={member.consent_status} size="sm" />,
    });
  }

  if (delivery) {
    columns.push(
      {
        id: 'delivered',
        header: t('members.delivered'),
        numeric: true,
        hideBelow: 'md',
        cell: (member) => <Quantity kg={member.delivered_kg} size="sm" className="font-normal" />,
        footer: <Quantity kg={sum((member) => member.delivered_kg)} size="sm" />,
      },
      {
        id: 'accepted',
        header: t('members.accepted'),
        numeric: true,
        sortFirst: 'desc',
        sortValue: (member) => member.accepted_kg,
        cell: (member) => <Quantity kg={member.accepted_kg} size="sm" className="text-forest-700" />,
        footer: <Quantity kg={sum((member) => member.accepted_kg)} size="sm" className="text-forest-700" />,
      },
      {
        id: 'rejected',
        header: t('members.rejected'),
        numeric: true,
        hideBelow: 'sm',
        cell: (member) =>
          member.rejected_kg ? (
            <span className="flex flex-col items-end gap-0.5">
              <Quantity kg={member.rejected_kg} size="sm" className="text-danger-ink" />
              {member.rejection_reason ? (
                <span className="max-w-48 truncate text-xs font-normal text-muted" title={member.rejection_reason}>
                  {member.rejection_reason}
                </span>
              ) : null}
            </span>
          ) : (
            <Quantity kg={member.rejected_kg} size="sm" className="font-normal text-muted" />
          ),
        footer: <Quantity kg={sum((member) => member.rejected_kg)} size="sm" />,
      },
    );
  }

  if (renderActions) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">{t('table.actions')}</span>,
      align: 'right',
      cell: (member) => <span className="inline-flex justify-end gap-2">{renderActions(member)}</span>,
    });
  }

  return (
    <DataTable
      label={t('members.label')}
      columns={columns}
      rows={members}
      getRowId={(member) => member.id}
      loading={loading}
      isRowSelected={(member) => member.is_mine}
      rowClassName={(member) => (member.consent_status === 'declined' ? 'opacity-60' : undefined)}
      emptyTitle={t('members.emptyTitle')}
      emptyDescription={t('members.emptyBody')}
      caption={caption}
      className={className}
    />
  );
}
