import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarClock,
  CircleCheck,
  CircleX,
  HandCoins,
  Handshake,
  MessageSquareText,
  Undo2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { NegotiationAction, NegotiationEntry, UUID } from '@/types/api';
import { useNow, useUiLanguage } from './hooks';
import { Delta, Money, Quantity } from './Money';

const ACTIONS: Record<NegotiationAction, { icon: LucideIcon; tone: string }> = {
  offer: { icon: HandCoins, tone: 'text-ink-2' },
  counter: { icon: ArrowLeftRight, tone: 'text-gold-700' },
  accept: { icon: CircleCheck, tone: 'text-success-ink' },
  reject: { icon: CircleX, tone: 'text-danger-ink' },
  withdraw: { icon: Undo2, tone: 'text-muted' },
  propose: { icon: Users, tone: 'text-ink-2' },
  consent: { icon: Handshake, tone: 'text-ink-2' },
  note: { icon: MessageSquareText, tone: 'text-muted' },
};

export interface NegotiationThreadProps {
  entries: readonly NegotiationEntry[];
  /** The signed-in user's id; their entries are marked "You". */
  viewerId?: UUID | null;
  className?: string;
}

/**
 * The negotiation as a ledger under hairline rules: who did what, the price before and after each
 * counter, quantity and payment changes, and automatic MandiMate entries in between.
 */
export function NegotiationThread({ entries, viewerId, className }: NegotiationThreadProps) {
  const { t } = useTranslation('domain');
  const ordered = [...entries].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (ordered.length === 0) {
    return <p className={cn('text-sm text-muted', className)}>{t('negotiation.empty')}</p>;
  }

  let previousPrice: number | null = null;
  const items = ordered.map((entry) => {
    const before = previousPrice;
    if (entry.price_per_kg !== null) previousPrice = entry.price_per_kg;
    return { entry, previousPrice: before };
  });

  return (
    <ol aria-label={t('negotiation.label')} className={cn('flex flex-col border-b border-line', className)}>
      {items.map(({ entry, previousPrice: before }) =>
        entry.author_role === 'system' ? (
          <SystemEntry key={entry.id} entry={entry} />
        ) : (
          <MessageEntry key={entry.id} entry={entry} previousPrice={before} mine={Boolean(viewerId) && entry.author_id === viewerId} />
        ),
      )}
    </ol>
  );
}

function EntryTime({ at }: { at: string }) {
  const now = useNow();
  const locale = useUiLanguage();
  return (
    <time dateTime={at} title={formatDateTime(at, { locale })} className="text-xs tabular-nums text-muted">
      {formatRelative(at, { now, locale })}
    </time>
  );
}

function ActionLabel({ action }: { action: NegotiationAction }) {
  const { t } = useTranslation('domain');
  const { icon: Icon, tone } = ACTIONS[action];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-semibold', tone)}>
      <Icon aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
      {t(`common:enums.negotiationAction.${action}`)}
    </span>
  );
}

function SystemEntry({ entry }: { entry: NegotiationEntry }) {
  const { t } = useTranslation('domain');
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-parchment/40 px-4 py-3">
      <span className="text-[13px] font-semibold text-gold-700">{t('negotiation.system')}</span>
      <ActionLabel action={entry.action} />
      {entry.message ? <span className="text-xs text-muted">{entry.message}</span> : null}
      <span className="ms-auto">
        <EntryTime at={entry.created_at} />
      </span>
    </li>
  );
}

interface MessageEntryProps {
  entry: NegotiationEntry;
  previousPrice: number | null;
  mine: boolean;
}

function MessageEntry({ entry, previousPrice, mine }: MessageEntryProps) {
  const { t } = useTranslation('domain');
  const priceChanged = entry.price_per_kg !== null && previousPrice !== null && entry.price_per_kg !== previousPrice;
  const terms: ReactNode[] = [];
  if (entry.quantity_kg !== null) terms.push(<Quantity key="qty" kg={entry.quantity_kg} size="sm" />);
  if (entry.payment_terms_days !== null) {
    terms.push(
      <span key="pay" className="inline-flex items-center gap-1">
        <CalendarClock aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-muted" />
        {t('common:money.paymentIn', { count: entry.payment_terms_days })}
      </span>,
    );
  }

  return (
    <li className="flex items-start gap-4 border-t border-line py-5">
      <Avatar name={entry.author_name} size="sm" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <span className={cn('text-sm font-medium', mine ? 'text-gold-700' : 'text-ink')}>
              {mine ? t('negotiation.you') : entry.author_name}
            </span>
            <span className="text-[13px] font-semibold text-muted">{t(`common:enums.role.${entry.author_role}`)}</span>
          </span>
          <EntryTime at={entry.created_at} />
        </p>
        <div className="flex flex-col gap-2.5">
          <ActionLabel action={entry.action} />
          {entry.price_per_kg !== null ? (
            <div className="flex flex-wrap items-center gap-2">
              {priceChanged ? (
                <>
                  <span className="text-sm text-muted line-through decoration-ink/30">
                    <Money value={previousPrice} perKg size="sm" className="font-normal" />
                  </span>
                  <ArrowRight aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-muted" />
                </>
              ) : null}
              <Money value={entry.price_per_kg} perKg size="lg" className="text-ink" />
              {priceChanged && previousPrice !== null ? (
                <Delta value={entry.price_per_kg - previousPrice} label={null} />
              ) : null}
            </div>
          ) : null}
          {terms.length > 0 ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">{terms}</div> : null}
          {entry.message ? <p className="max-w-measure text-sm font-normal leading-relaxed text-ink-2">{entry.message}</p> : null}
        </div>
      </div>
    </li>
  );
}
