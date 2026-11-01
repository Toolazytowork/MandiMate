import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Inbox, Mic, Plus, Sprout } from 'lucide-react';

import { Card, LinkButton } from '@/components/ui';
import { CropGlyph, GradeBadge, Money, PageHeader, QueryState, Quantity, StatusBadge } from '@/components/domain';
import { cn } from '@/lib/cn';
import { Seo } from '@/lib/seo';
import type { Harvest } from '@/types/api';

import { Dot } from '@/features/farmer/components/Surfaces';
import { useMyHarvests } from '@/features/farmer/hooks';
import { committedKg, harvestMatchesFilter, sortHarvests, type HarvestFilter } from '@/features/farmer/lib';
import { useHarvestWords } from '@/features/farmer/useHarvestWords';

const FILTERS: HarvestFilter[] = ['all', 'selling', 'deal', 'sold', 'closed'];

export default function HarvestsPage() {
  const { t } = useTranslation('farmer');
  const harvests = useMyHarvests();
  const [filter, setFilter] = useState<HarvestFilter>('selling');

  const labels: Record<HarvestFilter, string> = {
    all: t('harvests.all', { defaultValue: 'All' }),
    selling: t('harvests.selling', { defaultValue: 'For sale' }),
    deal: t('harvests.deal', { defaultValue: 'Sold, on the way' }),
    sold: t('harvests.sold', { defaultValue: 'Paid' }),
    closed: t('harvests.closed', { defaultValue: 'Closed' }),
  };

  const counts = useMemo(() => {
    const list = harvests.data ?? [];
    return Object.fromEntries(FILTERS.map((f) => [f, list.filter((h) => harvestMatchesFilter(h.status, f)).length])) as Record<HarvestFilter, number>;
  }, [harvests.data]);

  return (
    <div className="flex flex-col gap-8">
      <Seo
        title={t('harvests.title', { defaultValue: 'Your harvests' })}
        description={t('harvests.lede', { defaultValue: 'Everything you have listed, what is still free to sell and what is promised.' })}
        path="/app/farmer/harvests"
        noindex
      />
      <PageHeader
        eyebrow={t('harvests.eyebrow', { defaultValue: 'Your produce' })}
        title={t('harvests.title', { defaultValue: 'Your harvests' })}
        description={t('harvests.lede', { defaultValue: 'Everything you have listed, what is still free to sell and what is promised.' })}
        actions={
          <>
            <LinkButton to="/app/farmer/harvests/new?voice=1" variant="secondary" size="lg" leadingIcon={<Mic strokeWidth={1.25} className="size-5" />}>
              {t('home.speak', { defaultValue: 'Speak to list' })}
            </LinkButton>
            <LinkButton to="/app/farmer/harvests/new" size="lg" leadingIcon={<Plus strokeWidth={1.25} className="size-5" />}>
              {t('home.list', { defaultValue: 'List a harvest' })}
            </LinkButton>
          </>
        }
      />

      <div
        role="group"
        aria-label={t('harvests.filter', { defaultValue: 'Show harvests' })}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'inline-flex min-h-12 shrink-0 items-center gap-2.5 rounded-sm border px-5 text-[13px] font-semibold transition-colors duration-300 ease-luxe focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-700',
              filter === f ? 'border-forest-600 bg-forest-600 text-white' : 'border-line bg-transparent text-ink-2 hover:border-forest-400 hover:text-ink',
            )}
          >
            {labels[f]}
            {harvests.data ? <span className={cn('tabular-nums tracking-normal', filter === f ? 'text-gold-400' : 'text-muted')}>{counts[f]}</span> : null}
          </button>
        ))}
      </div>

      <QueryState
        query={harvests}
        skeleton="cards"
        empty={{
          title: t('harvests.emptyTitle', { defaultValue: 'No harvests yet' }),
          description: t('harvests.emptyBody', { defaultValue: 'List your first harvest. It takes about a minute, or you can say it out loud.' }),
          icon: <Sprout strokeWidth={1.25} />,
          action: (
            <LinkButton to="/app/farmer/harvests/new" size="lg" leadingIcon={<Plus strokeWidth={1.25} className="size-5" />}>
              {t('home.list', { defaultValue: 'List a harvest' })}
            </LinkButton>
          ),
        }}
      >
        {(list) => {
          const shown = sortHarvests(list.filter((h) => harvestMatchesFilter(h.status, filter)));
          if (shown.length === 0) {
            return (
              <Card variant="dashed" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <Inbox strokeWidth={1.25} aria-hidden="true" className="size-6 text-muted" />
                <p className="font-display text-2xl font-bold text-ink">{t('harvests.noneHere', { defaultValue: 'Nothing here' })}</p>
                <p className="text-sm text-muted">{t('harvests.noneHereBody', { defaultValue: 'Try another filter above.' })}</p>
              </Card>
            );
          }
          return (
            <ul className="grid gap-6 md:grid-cols-2">
              {shown.map((harvest) => (
                <li key={harvest.id}>
                  <HarvestRow harvest={harvest} />
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </div>
  );
}

function HarvestRow({ harvest }: { harvest: Harvest }) {
  const { t } = useTranslation('farmer');
  const words = useHarvestWords();
  const committed = committedKg(harvest);
  const availablePct = harvest.quantity_kg > 0 ? Math.round((harvest.available_kg / harvest.quantity_kg) * 100) : 0;
  const open = ['draft', 'listed', 'pooled'].includes(harvest.status);

  return (
    <Link
      to={`/app/farmer/harvests/${harvest.id}`}
      className="group block h-full rounded-card focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-700"
    >
      <Card interactive className="flex h-full flex-col gap-6 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <CropGlyph name={harvest.crop_name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="harvest" value={harvest.status} size="sm" />
              <GradeBadge grade={harvest.grade} size="sm" />
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold leading-snug text-ink">{words.title(harvest)}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
              <span>{words.ready(harvest.available_from)}</span>
              <Dot />
              <span>{words.sellBy(harvest.sell_by)}</span>
            </p>
          </div>
          <ChevronRight strokeWidth={1.25} aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex h-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <span className="bg-ink" style={{ width: `${100 - availablePct}%` }} />
            <span className="bg-gold-400" style={{ width: `${availablePct}%` }} />
          </div>
          <dl className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-gold-400" />
              <dt className="text-[13px] font-semibold text-muted">{t('harvests.available', { defaultValue: 'Free to sell' })}</dt>
              <dd><Quantity kg={harvest.available_kg} size="sm" /></dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" />
              <dt className="text-[13px] font-semibold text-muted">{t('harvests.committed', { defaultValue: 'Promised' })}</dt>
              <dd><Quantity kg={committed} size="sm" /></dd>
            </div>
          </dl>
        </div>

        {open && (harvest.open_offers_count > 0 || harvest.best_offer_price_per_kg) ? (
          <p className="mt-auto flex flex-wrap items-center gap-x-2 border-t border-line pt-4 text-sm text-ink">
            {t('harvests.offers', { defaultValue: '{{count}} open offers', count: harvest.open_offers_count })}
            {harvest.best_offer_price_per_kg ? (
              <>
                <Dot />
                <span className="text-muted">{t('harvests.best', { defaultValue: 'best offer, before costs' })}</span>
                <Money value={harvest.best_offer_price_per_kg} perKg size="sm" />
              </>
            ) : null}
          </p>
        ) : null}
      </Card>
    </Link>
  );
}
