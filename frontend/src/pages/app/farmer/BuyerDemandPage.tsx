import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, CalendarClock, Lightbulb, MapPin, Megaphone, Plus } from 'lucide-react';

import { Badge, Card, LinkButton, SegmentedControl } from '@/components/ui';
import { CertaintyBadge, CropGlyph, GradeBadge, Money, PageHeader, Quantity, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { useDemandNetEstimates, useMyHarvests, useOpenDemands } from '@/features/farmer/hooks';
import { POOLABLE_HARVEST_STATUSES, roadKm } from '@/features/farmer/lib';
import { FARMER_BASE, Fact } from '@/features/farmer-deals/shared';
import { useAuth } from '@/lib/auth';
import { formatDate, formatKg, formatPerKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Demand, Harvest, NetProceeds } from '@/types/api';

type Scope = 'mine' | 'all';

export default function BuyerDemandPage() {
  const { t } = useTranslation('farmerDeals');
  const demands = useOpenDemands();
  return (
    <div className="flex flex-col gap-10">
      <Seo
        title={t('demand.seoTitle', { defaultValue: 'Buyer demand' })}
        description={t('demand.description', { defaultValue: 'What buyers are looking for right now, and what it could mean for you.' })}
        path={`${FARMER_BASE}/demand`}
        noindex
      />
      <PageHeader
        eyebrow={t('demand.eyebrow', { defaultValue: 'What buyers want' })}
        title={t('demand.title', { defaultValue: 'Buyer demand' })}
        description={t('demand.description', { defaultValue: 'What buyers are looking for right now, and what it could mean for you.' })}
      />
      <QueryState
        query={demands}
        skeleton="cards"
        empty={{
          icon: <Megaphone strokeWidth={1.25} />,
          title: t('demand.empty', { defaultValue: 'No open buyer requests right now' }),
          description: t('demand.emptyBody', { defaultValue: 'Keep your harvests listed. New requests are matched to them automatically.' }),
        }}
      >
        {(data) => <DemandList demands={data} />}
      </QueryState>
    </div>
  );
}

function DemandList({ demands }: { demands: Demand[] }) {
  const { t } = useTranslation('farmerDeals');
  const { user } = useAuth();
  const harvests = useMyHarvests();
  const ready = useMemo(
    () => (harvests.data ?? []).filter((harvest) => POOLABLE_HARVEST_STATUSES.includes(harvest.status) && harvest.available_kg > 0),
    [harvests.data],
  );
  const myCrops = useMemo(() => new Set(ready.map((harvest) => harvest.crop_id)), [ready]);
  const [scope, setScope] = useState<Scope>('all');

  const distanceFor = useCallback(
    (demand: Demand) =>
      user?.latitude != null && user.longitude != null && demand.delivery_latitude != null && demand.delivery_longitude != null
        ? roadKm(user.latitude, user.longitude, demand.delivery_latitude, demand.delivery_longitude)
        : null,
    [user?.latitude, user?.longitude],
  );
  const sorted = useMemo(
    () => [...demands].sort((a, b) => Number(myCrops.has(b.crop_id)) - Number(myCrops.has(a.crop_id)) || a.needed_by.localeCompare(b.needed_by)),
    [demands, myCrops],
  );
  const shown = scope === 'mine' ? sorted.filter((demand) => myCrops.has(demand.crop_id)) : sorted;
  const estimates = useDemandNetEstimates(shown, distanceFor);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm font-normal leading-relaxed text-ink-2">
          {t('demand.readOnly', {
            defaultValue: 'You do not need to reply here. MandiMate pools matching harvests and brings the offers to you, with your take-home worked out.',
          })}
        </p>
        <SegmentedControl<Scope>
          label={t('demand.scope', { defaultValue: 'Show requests' })}
          value={scope}
          onValueChange={setScope}
          options={[
            { value: 'all', label: t('demand.all', { defaultValue: 'All crops' }) },
            { value: 'mine', label: t('demand.mine', { defaultValue: 'My crops' }) },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="py-2 text-sm font-normal text-ink-2">
          {t('demand.noneForYou', { defaultValue: 'No buyer is asking for the crops you have listed right now.' })}
        </p>
      ) : (
        <StaggerGroup className="grid gap-6 md:grid-cols-2">
          {shown.map((demand) => (
            <StaggerItem key={demand.id}>
              <DemandCard demand={demand} estimate={estimates.get(demand.id)} mine={ready.filter((harvest) => harvest.crop_id === demand.crop_id)} />
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
    </div>
  );
}

function DemandCard({ demand, estimate, mine }: { demand: Demand; estimate: NetProceeds | undefined; mine: Harvest[] }) {
  const { t } = useTranslation('farmerDeals');
  const myKg = mine.reduce((sum, harvest) => sum + harvest.available_kg, 0);
  const place = [demand.delivery_location, demand.delivery_district].filter(Boolean).join(', ');

  return (
    <Card as="article" className="flex h-full flex-col">
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <header className="flex items-start gap-4">
          <CropGlyph name={demand.crop_name} size="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-muted">
              {demand.buyer_name}
              {demand.buyer_verified ? <BadgeCheck aria-label={t('demand.verified', { defaultValue: 'Verified buyer' })} strokeWidth={1.25} className="size-3.5 text-forest-600" /> : null}
            </p>
            <h2 className="font-display text-2xl font-bold leading-snug text-ink">
              {t('demand.cardTitle', { defaultValue: '{{kg}} of {{crop}}', kg: formatKg(demand.quantity_kg), crop: demand.crop_name })}
            </h2>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <GradeBadge grade={demand.grade_required} size="sm" />
              {myKg > 0 ? (
                <Badge tone="forest" dot>
                  {t('demand.youGrow', { defaultValue: 'You have this crop' })}
                </Badge>
              ) : null}
            </div>
          </div>
          {demand.target_price_per_kg !== null ? (
            <div className="text-end">
              <p className="text-[13px] font-semibold text-muted">{t('demand.target', { defaultValue: 'Target' })}</p>
              <Money value={demand.target_price_per_kg} perKg size="lg" className="font-display font-bold text-ink" />
            </div>
          ) : null}
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Fact label={t('demand.neededBy', { defaultValue: 'Needed by' })}>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-muted" />
              {formatDate(demand.needed_by)}
            </span>
          </Fact>
          <Fact label={t('demand.minLot', { defaultValue: 'Smallest lot' })}>
            <Quantity kg={demand.min_quantity_kg} />
          </Fact>
          <Fact label={t('demand.place', { defaultValue: 'Deliver to' })} className="col-span-2">
            <span className="inline-flex items-start gap-1.5">
              <MapPin aria-hidden="true" strokeWidth={1.25} className="mt-1 size-3.5 shrink-0 text-muted" />
              {place}
            </span>
          </Fact>
          <Fact label={t('demand.pays', { defaultValue: 'Pays within' })}>
            {t('demand.days', { defaultValue: '{{days}} days', days: demand.payment_terms_days })}
          </Fact>
          <Fact label={t('demand.rejection', { defaultValue: 'Rejection up to' })}>{demand.max_rejection_pct}%</Fact>
        </dl>
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-line px-6 py-6 sm:px-8">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-gold-700">
          <Lightbulb aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
          {t('demand.meaning', { defaultValue: 'What this means for you' })}
        </p>
        {estimate ? (
          <p className="flex flex-wrap items-center gap-2 text-sm leading-relaxed text-ink">
            {t('demand.estimate', {
              defaultValue: 'At the target price, farmers in a pooled lot would take home about {{perKg}} after transport, handling, rejection and the payment wait.',
              perKg: formatPerKg(estimate.net_per_kg),
            })}
            <CertaintyBadge certainty={estimate.confidence} size="sm" />
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted">
            {t('demand.noTarget', { defaultValue: 'No target price yet. Buyers will make offers, and you will see your take-home before you decide.' })}
          </p>
        )}
        {myKg > 0 ? (
          <p className="text-sm leading-relaxed text-ink">
            {t('demand.youHave', {
              defaultValue: 'You have {{kg}} of {{crop}} ready. It can be pooled toward this order.',
              kg: formatKg(myKg),
              crop: demand.crop_name,
            })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {t('demand.noneListed', { defaultValue: 'You have no {{crop}} listed.', crop: demand.crop_name })}
            </p>
            <LinkButton to={`${FARMER_BASE}/harvests/new`} size="sm" variant="secondary" leadingIcon={<Plus strokeWidth={1.25} />}>
              {t('offers.listHarvest', { defaultValue: 'List a harvest' })}
            </LinkButton>
          </div>
        )}
      </div>
    </Card>
  );
}
