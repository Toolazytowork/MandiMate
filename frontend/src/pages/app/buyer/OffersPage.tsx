import { HandCoins, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KpiStrip, OfferCard, PageHeader, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { EmptyState, LinkButton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { offerBucket, type OfferBucket } from '@/features/buyer/utils';
import { useBuyerOffers } from '@/features/buyer-orders/hooks';
import { Seo } from '@/lib/seo';
import type { Offer } from '@/types/api';

type TabId = 'yours' | 'seller' | 'closed';

const TAB_OF: Record<OfferBucket, TabId> = { yours: 'yours', seller: 'seller', accepted: 'closed', closed: 'closed' };

function sortOffers(offers: readonly Offer[]): Offer[] {
  return [...offers].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export default function OffersPage() {
  const { t } = useTranslation('buyerOrders');
  const query = useBuyerOffers();
  const groups = useMemo(() => {
    const out: Record<TabId, Offer[]> = { yours: [], seller: [], closed: [] };
    for (const offer of sortOffers(query.data ?? [])) out[TAB_OF[offerBucket(offer)]].push(offer);
    return out;
  }, [query.data]);
  const [tab, setTab] = useState<TabId | null>(null);
  const active: TabId = tab ?? (groups.yours.length > 0 || !query.data ? 'yours' : 'seller');

  const empties: Record<TabId, { title: string; description: string }> = {
    yours: {
      title: t('offers.emptyYours', { defaultValue: 'Nothing waits on you' }),
      description: t('offers.emptyYoursBody', { defaultValue: 'Counter-offers from sellers land here for your reply.' }),
    },
    seller: {
      title: t('offers.emptySeller', { defaultValue: 'No offers in flight' }),
      description: t('offers.emptySellerBody', { defaultValue: 'Offers waiting on a seller or on farmers’ consent appear here.' }),
    },
    closed: {
      title: t('offers.emptyClosed', { defaultValue: 'No closed offers yet' }),
      description: t('offers.emptyClosedBody', { defaultValue: 'Accepted, rejected, withdrawn and expired offers are kept here.' }),
    },
  };

  return (
    <>
      <Seo
        title={t('offers.seoTitle', { defaultValue: 'Offers' })}
        description={t('offers.seoDescription', { defaultValue: 'Offers you have made, counters awaiting your reply and accepted deals.' })}
        path="/app/buyer/offers"
        noindex
      />
      <div className="space-y-10">
        <PageHeader
          eyebrow={t('offers.eyebrow', { defaultValue: 'Procurement' })}
          title={t('offers.title', { defaultValue: 'Offers' })}
          description={t('offers.description', {
            defaultValue: 'Every negotiation in one ledger — what needs your answer, what the seller is weighing, and what has closed.',
          })}
          actions={
            <LinkButton to="/app/buyer/supply" leadingIcon={<Plus strokeWidth={1.25} aria-hidden />}>
              {t('offers.new', { defaultValue: 'Make an offer' })}
            </LinkButton>
          }
        />

        <KpiStrip
          loading={query.isPending}
          columns={3}
          items={[
            { id: 'yours', label: t('offers.tabYours', { defaultValue: 'Awaiting you' }), value: groups.yours.length },
            { id: 'seller', label: t('offers.tabSeller', { defaultValue: 'Awaiting seller' }), value: groups.seller.length },
            {
              id: 'accepted',
              label: t('offers.accepted', { defaultValue: 'Accepted' }),
              value: groups.closed.filter((o) => o.status === 'accepted').length,
            },
          ]}
        />

        <QueryState query={query} skeleton="cards">
          {() => (
            <Tabs value={active} defaultValue="yours" onValueChange={(v) => setTab(v as TabId)}>
              <TabsList label={t('offers.tabsLabel', { defaultValue: 'Filter offers' })}>
                <TabsTrigger value="yours" count={groups.yours.length}>
                  {t('offers.tabYours', { defaultValue: 'Awaiting you' })}
                </TabsTrigger>
                <TabsTrigger value="seller" count={groups.seller.length}>
                  {t('offers.tabSeller', { defaultValue: 'Awaiting seller' })}
                </TabsTrigger>
                <TabsTrigger value="closed" count={groups.closed.length}>
                  {t('offers.tabClosed', { defaultValue: 'Closed' })}
                </TabsTrigger>
              </TabsList>
              {(Object.keys(groups) as TabId[]).map((id) => (
                <TabsContent key={id} value={id} className="pt-6">
                  {groups[id].length === 0 ? (
                    <EmptyState
                      framed
                      icon={<HandCoins strokeWidth={1.25} aria-hidden />}
                      title={empties[id].title}
                      description={empties[id].description}
                      action={
                        id === 'yours' ? undefined : (
                          <LinkButton to="/app/buyer/supply" variant="secondary">
                            {t('offers.browseSupply', { defaultValue: 'Browse supply' })}
                          </LinkButton>
                        )
                      }
                    />
                  ) : (
                    <StaggerGroup className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                      {groups[id].map((offer) => (
                        <StaggerItem key={offer.id}>
                          <OfferCard offer={offer} to={`/app/buyer/offers/${offer.id}`} showBuyer={false} className="h-full" />
                        </StaggerItem>
                      ))}
                    </StaggerGroup>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </QueryState>
      </div>
    </>
  );
}
