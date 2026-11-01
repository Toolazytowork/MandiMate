import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';

import { FilterBar, PageHeader, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { Button, SegmentedControl, Select, Switch } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { Seo } from '@/lib/seo';
import type { TransportRequest } from '@/types/api';

import { RequestCard } from '@/features/transporter/components/RequestCard';
import { fleetFits } from '@/features/transporter/fleet';
import { useTransportRequests, useVehicles } from '@/features/transporter/hooks';
import { inPickupWindow, isQuotable, myQuotes, requestSearchText, type PickupWindow } from '@/features/transporter/requests';

type Sort = 'date' | 'kg' | 'value' | 'distance';

export default function RequestsPage() {
  const { t } = useTranslation('transporter');
  const { user } = useAuth();
  const requests = useTransportRequests({ limit: 100 });
  const vehicles = useVehicles();

  const [search, setSearch] = useState('');
  const [pickupWindow, setPickupWindow] = useState<PickupWindow>('any');
  const [coldOnly, setColdOnly] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('date');

  const activeCount = (search ? 1 : 0) + (pickupWindow !== 'any' ? 1 : 0) + (coldOnly ? 1 : 0) + (fitsOnly ? 1 : 0);
  const clear = () => {
    setSearch('');
    setPickupWindow('any');
    setColdOnly(false);
    setFitsOnly(false);
  };

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-IN');
    const rows = (requests.data ?? []).filter(
      (request) =>
        isQuotable(request) &&
        (!query || requestSearchText(request).includes(query)) &&
        inPickupWindow(request.pickup_date, pickupWindow) &&
        (!coldOnly || request.requires_refrigeration) &&
        (!fitsOnly || fleetFits(vehicles.data, request)),
    );
    const by: Record<Sort, (a: TransportRequest, b: TransportRequest) => number> = {
      date: (a, b) => a.pickup_date.localeCompare(b.pickup_date),
      kg: (a, b) => b.total_quantity_kg - a.total_quantity_kg,
      value: (a, b) => b.estimated_cost - a.estimated_cost,
      distance: (a, b) => a.estimated_distance_km - b.estimated_distance_km,
    };
    return [...rows].sort(by[sort]);
  }, [requests.data, search, coldOnly, fitsOnly, sort, vehicles.data, pickupWindow]);

  return (
    <div className="flex flex-col gap-8">
      <Seo title={t('requests.seoTitle', { defaultValue: 'Pickup requests' })} description={t('requests.seoDescription', { defaultValue: 'Open pooled pickups waiting for a quote.' })} path="/app/transporter/requests" noindex />
      <PageHeader
        eyebrow={t('requests.eyebrow', { defaultValue: 'Loads' })}
        title={t('requests.title', { defaultValue: 'Pickup requests' })}
        description={t('requests.description', { defaultValue: 'Pooled harvests from several farms, routed in order and ready to quote. Price the whole run — MandiMate shows its own estimate beside yours.' })}
        breadcrumbs={[{ label: t('nav.home', { defaultValue: 'Home' }), to: '/app/transporter' }, { label: t('requests.title', { defaultValue: 'Pickup requests' }) }]}
        divider
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('requests.search', { defaultValue: 'Search crop, lot, village or market' })}
        activeCount={activeCount}
        onClear={clear}
        resultLabel={requests.data ? t('requests.count', { defaultValue: '{{count}} requests', count: visible.length }) : undefined}
      >
        <SegmentedControl<PickupWindow>
          label={t('requests.window', { defaultValue: 'Pickup window' })}
          size="sm"
          value={pickupWindow}
          onValueChange={setPickupWindow}
          options={[
            { value: 'any', label: t('requests.windowAny', { defaultValue: 'Any day' }) },
            { value: 'today', label: t('requests.windowToday', { defaultValue: 'Today' }) },
            { value: 'next3', label: t('requests.window3', { defaultValue: '3 days' }) },
            { value: 'week', label: t('requests.windowWeek', { defaultValue: 'Week' }) },
          ]}
        />
        <Select
          size="sm"
          aria-label={t('requests.sort', { defaultValue: 'Sort by' })}
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          wrapperClassName="w-44"
        >
          <option value="date">{t('requests.sortDate', { defaultValue: 'Soonest pickup' })}</option>
          <option value="kg">{t('requests.sortKg', { defaultValue: 'Heaviest load' })}</option>
          <option value="value">{t('requests.sortValue', { defaultValue: 'Highest estimate' })}</option>
          <option value="distance">{t('requests.sortDistance', { defaultValue: 'Shortest route' })}</option>
        </Select>
        <Switch checked={coldOnly} onCheckedChange={setColdOnly} label={t('requests.coldOnly', { defaultValue: 'Cold chain' })} />
        <Switch checked={fitsOnly} onCheckedChange={setFitsOnly} label={t('requests.fitsOnly', { defaultValue: 'Fits my fleet' })} />
      </FilterBar>

      <QueryState
        query={requests}
        skeleton="cards"
        isEmpty={() => visible.length === 0}
        errorTitle={t('requests.error', { defaultValue: 'Could not load requests' })}
        empty={{
          icon: <ClipboardList strokeWidth={1.25} />,
          title: activeCount > 0 ? t('requests.emptyFiltered', { defaultValue: 'Nothing matches these filters' }) : t('requests.empty', { defaultValue: 'No open requests right now' }),
          description:
            activeCount > 0
              ? t('requests.emptyFilteredBody', { defaultValue: 'Widen the pickup window or clear the filters.' })
              : t('requests.emptyBody', { defaultValue: 'Coordinators post a request once a lot is sold and farmers have consented. New loads appear here first.' }),
          action: activeCount > 0 ? <Button variant="secondary" onClick={clear}>{t('requests.clear', { defaultValue: 'Clear filters' })}</Button> : undefined,
        }}
      >
        {() => (
          <StaggerGroup className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((request) => (
              <StaggerItem key={request.id}>
                <RequestCard
                  request={request}
                  to={`/app/transporter/requests/${request.id}`}
                  myQuote={myQuotes(request, user?.id)[0] ?? null}
                  fits={fleetFits(vehicles.data, request)}
                  className="h-full"
                />
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </QueryState>
    </div>
  );
}
