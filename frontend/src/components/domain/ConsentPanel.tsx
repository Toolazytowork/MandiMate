import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { ConsentDecision, ISODateTime, LotMember, OfferConsent, UUID } from '@/types/api';
import { useUiLanguage } from './hooks';
import { Quantity, useKgFormatter } from './Money';
import { StatusBadge } from './StatusBadge';

/** One farmer's decision, normalised from an `OfferConsent` or a `LotMember`. */
export interface ConsentEntry {
  /** The lot member id (what consent endpoints take). */
  memberId: UUID;
  farmerName: string;
  village: string | null;
  quantityKg: number;
  decision: ConsentDecision;
  decidedAt: ISODateTime | null;
  isMine: boolean;
}

export function consentFromOffer(consent: OfferConsent): ConsentEntry {
  return {
    memberId: consent.member_id,
    farmerName: consent.farmer_name,
    village: null,
    quantityKg: consent.quantity_kg,
    decision: consent.decision,
    decidedAt: consent.decided_at,
    isMine: consent.is_mine,
  };
}

export function consentFromMember(member: LotMember): ConsentEntry {
  return {
    memberId: member.id,
    farmerName: member.farmer_name,
    village: member.village,
    quantityKg: member.quantity_kg,
    decision: member.consent_status,
    decidedAt: member.consented_at,
    isMine: member.is_mine,
  };
}

export interface ConsentTally {
  total: number;
  accepted: number;
  pending: number;
  declined: number;
  acceptedKg: number;
  pendingKg: number;
  declinedKg: number;
  totalKg: number;
}

export function tallyConsents(entries: readonly ConsentEntry[]): ConsentTally {
  const tally: ConsentTally = { total: entries.length, accepted: 0, pending: 0, declined: 0, acceptedKg: 0, pendingKg: 0, declinedKg: 0, totalKg: 0 };
  for (const entry of entries) {
    tally[entry.decision] += 1;
    tally[`${entry.decision}Kg`] += entry.quantityKg;
    tally.totalKg += entry.quantityKg;
  }
  return tally;
}

type ConsentSource = { consents: readonly OfferConsent[]; members?: never } | { members: readonly LotMember[]; consents?: never };

export type ConsentPanelProps = ConsentSource & {
  title?: ReactNode;
  description?: ReactNode;
  /** Per-farmer slot, e.g. the farmer's own Agree / Decline buttons or a coordinator's assisted consent. */
  renderAction?: (entry: ConsentEntry) => ReactNode;
  className?: string;
};

/**
 * Who has agreed so far: a segmented progress bar by kilograms (agreed / waiting / declined) and
 * one row per farmer, with the viewer's own row highlighted.
 */
export function ConsentPanel({ title, description, renderAction, className, ...source }: ConsentPanelProps) {
  const { t } = useTranslation('domain');
  const locale = useUiLanguage();
  const formatKg = useKgFormatter();
  const entries = source.consents ? source.consents.map(consentFromOffer) : (source.members ?? []).map(consentFromMember);
  const tally = tallyConsents(entries);
  const share = (kg: number) => (tally.totalKg > 0 ? (kg / tally.totalKg) * 100 : 0);

  return (
    <section className={cn('flex flex-col gap-5', className)}>
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="font-display text-h3 font-bold text-ink">{title ?? t('consent.title')}</h3>
            {description ? <p className="text-sm font-normal text-ink-2">{description}</p> : null}
          </div>
          <p className="shrink-0 text-end font-display text-h2 font-bold tabular-nums text-ink">
            {tally.accepted}
            <span className="text-[0.6em] text-muted">/{tally.total}</span>
          </p>
        </div>

        <div
          role="img"
          aria-label={t('consent.progressLabel', {
            accepted: tally.accepted,
            total: tally.total,
            acceptedKg: formatKg(tally.acceptedKg),
            totalKg: formatKg(tally.totalKg),
          })}
          className="flex h-1 w-full gap-[2px]"
        >
          {tally.acceptedKg > 0 ? <span className="h-full bg-forest-600" style={{ width: `${share(tally.acceptedKg)}%` }} /> : null}
          {tally.pendingKg > 0 ? (
            <span className="h-full bg-gold-300" style={{ width: `${share(tally.pendingKg)}%` }} />
          ) : null}
          {tally.declinedKg > 0 ? <span className="h-full bg-ink/15" style={{ width: `${share(tally.declinedKg)}%` }} /> : null}
          {tally.totalKg === 0 ? <span className="h-full w-full bg-ink/[0.06]" /> : null}
        </div>

        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <LegendItem swatch="bg-forest-600" label={t('consent.agreed', { count: tally.accepted, kg: formatKg(tally.acceptedKg) })} />
          <LegendItem
            swatch="bg-gold-300"
            label={t('consent.waiting', { count: tally.pending, kg: formatKg(tally.pendingKg) })}
          />
          {tally.declined > 0 ? (
            <LegendItem swatch="bg-ink/15" label={t('consent.declined', { count: tally.declined, kg: formatKg(tally.declinedKg) })} />
          ) : null}
        </ul>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">{t('consent.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {entries.map((entry) => (
            <li
              key={entry.memberId}
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-3 px-1 py-4',
                entry.isMine && 'bg-gold-50/60 px-4 shadow-[inset_1px_0_0_var(--color-gold-500)]',
              )}
            >
              <Avatar name={entry.farmerName} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-ink">
                  <span className="truncate">{entry.farmerName}</span>
                  {entry.isMine ? (
                    <span className="text-[13px] font-semibold text-gold-700">{t('consent.you')}</span>
                  ) : null}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <Quantity kg={entry.quantityKg} size="sm" className="font-normal text-ink-2" />
                  {entry.village ? <span>· {entry.village}</span> : null}
                  {entry.decidedAt ? (
                    <span>
                      ·{' '}
                      <time dateTime={entry.decidedAt}>{formatDateTime(entry.decidedAt, { locale })}</time>
                    </span>
                  ) : null}
                </p>
              </div>
              <StatusBadge kind="consent" value={entry.decision} size="sm" />
              {renderAction ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">{renderAction(entry)}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', swatch)} />
      {label}
    </li>
  );
}
