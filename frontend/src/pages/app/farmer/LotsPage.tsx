import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Combine, Plus, Users } from 'lucide-react';

import { Badge, Button, EmptyState, LinkButton, Skeleton } from '@/components/ui';
import { LotCard, PageHeader, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { useLots, useMyHarvests } from '@/features/farmer/hooks';
import { awaitingMyLotConsent, isJoinable, isMyLot, myMember } from '@/features/farmer/lib';
import { FARMER_BASE, FillMeter, GroupHeading, JoinLotDialog } from '@/features/farmer-deals/shared';
import { formatKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Harvest, Lot } from '@/types/api';

export default function LotsPage() {
  const { t } = useTranslation('farmerDeals');
  const mine = useLots({ mine: true });
  const all = useLots();
  const harvests = useMyHarvests();

  return (
    <div className="flex flex-col gap-12">
      <Seo
        title={t('lots.seoTitle', { defaultValue: 'Lots' })}
        description={t('lots.description', { defaultValue: 'Pools of small harvests sold together as one buyer-ready lot.' })}
        path={`${FARMER_BASE}/lots`}
        noindex
      />
      <PageHeader
        eyebrow={t('lots.eyebrow', { defaultValue: 'Selling together' })}
        title={t('lots.title', { defaultValue: 'Lots' })}
        description={t('lots.description', { defaultValue: 'Pools of small harvests sold together as one buyer-ready lot.' })}
      />

      <section aria-labelledby="lots-mine" className="flex flex-col gap-6">
        <QueryState query={mine} skeleton="cards" empty={<MineEmpty />} isEmpty={(lots) => lots.filter((lot) => isMyLot(lot) || awaitingMyLotConsent(lot)).length === 0}>
          {(lots) => <MyLots lots={lots.filter((lot) => isMyLot(lot) || awaitingMyLotConsent(lot))} />}
        </QueryState>
      </section>

      <section aria-labelledby="lots-joinable" className="flex flex-col gap-6">
        <JoinableLots lots={all.data} harvests={harvests.data} loading={all.isPending || harvests.isPending} />
      </section>
    </div>
  );
}

function MineEmpty() {
  const { t } = useTranslation('farmerDeals');
  return (
    <>
      <GroupHeading id="lots-mine" title={t('lots.mine', { defaultValue: 'Your lots' })} count={0} />
      <EmptyState
        framed
        icon={<Combine strokeWidth={1.25} />}
        title={t('lots.mineEmpty', { defaultValue: 'You are not in a lot yet' })}
        description={t('lots.mineEmptyBody', {
          defaultValue: 'When your harvest is pooled with neighbours, the lot appears here. You always decide before it is sold.',
        })}
      />
    </>
  );
}

function MyLots({ lots }: { lots: Lot[] }) {
  const { t } = useTranslation('farmerDeals');
  const sorted = useMemo(
    () => [...lots].sort((a, b) => Number(awaitingMyLotConsent(b)) - Number(awaitingMyLotConsent(a)) || b.updated_at.localeCompare(a.updated_at)),
    [lots],
  );
  return (
    <>
      <GroupHeading
        id="lots-mine"
        title={t('lots.mine', { defaultValue: 'Your lots' })}
        count={sorted.length}
        description={t('lots.mineBody', { defaultValue: 'Pools your harvest is part of, and where each one stands.' })}
      />
      <StaggerGroup className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((lot) => {
          const me = myMember(lot);
          const asks = awaitingMyLotConsent(lot);
          return (
            <StaggerItem key={lot.id}>
              <LotCard
                lot={lot}
                to={`${FARMER_BASE}/lots/${lot.id}`}
                className="h-full"
                actions={
                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    {asks ? (
                      <Badge tone="gold" dot>
                        {t('lots.needsYes', { defaultValue: 'Needs your yes or no' })}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted">
                        {t('lots.yourKg', { defaultValue: 'Your share: {{kg}}', kg: formatKg(me?.quantity_kg ?? 0) })}
                      </span>
                    )}
                    <LinkButton to={`${FARMER_BASE}/lots/${lot.id}`} size="sm" variant={asks ? 'primary' : 'secondary'} trailingIcon={<ArrowRight strokeWidth={1.25} />}>
                      {asks ? t('lots.review', { defaultValue: 'Review' }) : t('lots.open', { defaultValue: 'Open' })}
                    </LinkButton>
                  </div>
                }
              />
            </StaggerItem>
          );
        })}
      </StaggerGroup>
    </>
  );
}

function JoinableLots({ lots, harvests, loading }: { lots: Lot[] | undefined; harvests: Harvest[] | undefined; loading: boolean }) {
  const { t } = useTranslation('farmerDeals');
  const [joining, setJoining] = useState<Lot | null>(null);
  const joinable = useMemo(() => (lots && harvests ? lots.filter((lot) => isJoinable(lot, harvests)) : []), [lots, harvests]);

  return (
    <>
      <GroupHeading
        id="lots-joinable"
        title={t('lots.joinable', { defaultValue: 'Lots you can join' })}
        count={joinable.length}
        description={t('lots.joinableBody', {
          defaultValue: 'Open pools near you for a crop and grade you have ready. Joining is free and you can still say no to any deal.',
        })}
      />
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-64 rounded-panel" />
          ))}
        </div>
      ) : joinable.length === 0 ? (
        <EmptyState
          framed
          size="sm"
          icon={<Users strokeWidth={1.25} />}
          title={t('lots.joinableEmpty', { defaultValue: 'No open lots match your harvests right now' })}
          description={t('lots.joinableEmptyBody', { defaultValue: 'List a harvest and we will look for neighbours to pool it with.' })}
          action={
            <LinkButton to={`${FARMER_BASE}/harvests/new`} size="sm" leadingIcon={<Plus strokeWidth={1.25} />}>
              {t('offers.listHarvest', { defaultValue: 'List a harvest' })}
            </LinkButton>
          }
        />
      ) : (
        <StaggerGroup className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {joinable.map((lot) => (
            <StaggerItem key={lot.id}>
              <LotCard
                lot={lot}
                to={`${FARMER_BASE}/lots/${lot.id}`}
                showJourney={false}
                className="h-full"
                actions={
                  <div className="flex w-full flex-col gap-4">
                    <FillMeter total={lot.total_quantity_kg} target={lot.target_quantity_kg} />
                    <Button size="sm" leadingIcon={<Plus strokeWidth={1.25} />} onClick={() => setJoining(lot)}>
                      {t('join.submit', { defaultValue: 'Join this lot' })}
                    </Button>
                  </div>
                }
              />
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
      {joining && harvests ? (
        <JoinLotDialog lot={joining} harvests={harvests} open onOpenChange={(open) => (open ? undefined : setJoining(null))} />
      ) : null}
    </>
  );
}
