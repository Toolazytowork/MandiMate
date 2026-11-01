import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Handshake } from 'lucide-react';

import { Badge, LinkButton } from '@/components/ui';
import { OfferCard, PageHeader, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { useOfferBreakdowns, useOffers } from '@/features/farmer/hooks';
import { groupOffers, needsMyConsent, type OfferBucket } from '@/features/farmer/lib';
import { FARMER_BASE, GroupHeading, NetSummary } from '@/features/farmer-deals/shared';
import { Seo } from '@/lib/seo';
import type { NetProceeds, Offer, UUID } from '@/types/api';

export default function OffersPage() {
  const { t } = useTranslation('farmerDeals');
  const offers = useOffers();
  return (
    <div className="flex flex-col gap-10">
      <Seo
        title={t('offers.seoTitle', { defaultValue: 'Offers' })}
        description={t('offers.description', { defaultValue: 'Offers on your harvests and pooled lots, compared by what you take home.' })}
        path={`${FARMER_BASE}/offers`}
        noindex
      />
      <PageHeader
        eyebrow={t('offers.eyebrow', { defaultValue: 'Buyer offers' })}
        title={t('offers.title', { defaultValue: 'Offers' })}
        description={t('offers.description', { defaultValue: 'Offers on your harvests and pooled lots, compared by what you take home.' })}
      />
      <QueryState
        query={offers}
        skeleton="cards"
        empty={{
          icon: <Handshake strokeWidth={1.25} />,
          title: t('offers.emptyTitle', { defaultValue: 'No offers yet' }),
          description: t('offers.emptyBody', { defaultValue: 'When a buyer makes an offer on your harvest or your lot, it shows up here with what you would take home.' }),
          action: (
            <LinkButton to={`${FARMER_BASE}/harvests/new`} variant="primary">
              {t('offers.listHarvest', { defaultValue: 'List a harvest' })}
            </LinkButton>
          ),
        }}
      >
        {(data) => <OfferGroups offers={data} />}
      </QueryState>
    </div>
  );
}

function OfferGroups({ offers }: { offers: Offer[] }) {
  const { t } = useTranslation('farmerDeals');
  const groups = useMemo(() => groupOffers(offers), [offers]);
  const openIds = useMemo(() => [...groups.needs, ...groups.progress].map((offer) => offer.id), [groups]);
  const { byId, loading } = useOfferBreakdowns(openIds);

  const sections: { bucket: OfferBucket; title: string; description: string }[] = [
    {
      bucket: 'needs',
      title: t('offers.needs', { defaultValue: 'Needs your answer' }),
      description: t('offers.needsBody', { defaultValue: 'A buyer or your pool is waiting for you. Look at what you take home, then decide.' }),
    },
    {
      bucket: 'progress',
      title: t('offers.progress', { defaultValue: 'In progress' }),
      description: t('offers.progressBody', { defaultValue: 'Waiting for the buyer or the other farmers. Nothing to do right now.' }),
    },
    {
      bucket: 'closed',
      title: t('offers.closed', { defaultValue: 'Closed' }),
      description: t('offers.closedBody', { defaultValue: 'Agreed, turned down or expired.' }),
    },
  ];

  return (
    <div className="flex flex-col gap-14">
      {sections.map(({ bucket, title, description }) => {
        const list = groups[bucket];
        if (bucket !== 'needs' && list.length === 0) return null;
        return (
          <section key={bucket} aria-labelledby={`offers-${bucket}`} className="flex flex-col gap-6">
            <GroupHeading id={`offers-${bucket}`} title={title} count={list.length} description={description} />
            {list.length === 0 ? (
              <p className="py-2 text-sm font-normal text-ink-2">
                {t('offers.nothingNeeded', { defaultValue: 'You are all caught up. Nothing needs your answer.' })}
              </p>
            ) : (
              <StaggerGroup className="grid gap-6 md:grid-cols-2">
                {list.map((offer) => (
                  <StaggerItem key={offer.id}>
                    <OfferTile offer={offer} bucket={bucket} proceeds={byId.get(offer.id)} loading={loading.has(offer.id)} />
                  </StaggerItem>
                ))}
              </StaggerGroup>
            )}
          </section>
        );
      })}
    </div>
  );
}

function OfferTile({ offer, bucket, proceeds, loading }: { offer: Offer; bucket: OfferBucket; proceeds?: NetProceeds; loading: boolean }) {
  const { t } = useTranslation('farmerDeals');
  const to = `${FARMER_BASE}/offers/${offer.id as UUID}`;
  return (
    <OfferCard
      offer={offer}
      to={to}
      className="h-full"
      actions={
        <div className="flex w-full flex-col gap-4">
          {bucket !== 'closed' ? <NetSummary proceeds={proceeds} loading={loading} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {bucket === 'needs' ? (
              <Badge tone="gold" dot>
                {needsMyConsent(offer)
                  ? t('offers.poolAsks', { defaultValue: 'Your pool asks: yes or no?' })
                  : t('offers.buyerAsks', { defaultValue: 'Buyer waits for your answer' })}
              </Badge>
            ) : (
              <span />
            )}
            <LinkButton to={to} size="sm" variant={bucket === 'needs' ? 'primary' : 'secondary'} trailingIcon={<ArrowRight strokeWidth={1.25} />}>
              {bucket === 'needs' ? t('offers.answer', { defaultValue: 'Answer' }) : t('offers.view', { defaultValue: 'View' })}
            </LinkButton>
          </div>
        </div>
      }
    />
  );
}
