import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Mic, Sprout, UserPlus, Users } from 'lucide-react';
import { Avatar, Badge, LinkButton, Select } from '@/components/ui';
import {
  DataTable,
  FilterBar,
  KpiStrip,
  Money,
  PageHeader,
  Quantity,
  QueryState,
  useNow,
  useUiLanguage,
  type DataTableColumn,
  type KpiItem,
} from '@/components/domain';
import { Reveal } from '@/components/motion';
import { useFarmers } from '@/features/coordinator/hooks';
import { matchesSearch } from '@/features/coordinator/utils';
import { useDebounce } from '@/lib/hooks';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import { Seo } from '@/lib/seo';
import type { FarmerSummary, Language } from '@/types/api';

type LanguageFilter = Language | 'all';

export default function FarmersPage() {
  const { t } = useTranslation('coordinator');
  const navigate = useNavigate();
  const now = useNow();
  const locale = useUiLanguage();
  const farmers = useFarmers();
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<LanguageFilter>('all');
  const [village, setVillage] = useState('all');
  const query = useDebounce(search, 150);

  const villages = useMemo(
    () => [...new Set((farmers.data ?? []).map((farmer) => farmer.user.village).filter((name): name is string => Boolean(name)))].sort(),
    [farmers.data],
  );

  const rows = useMemo(
    () =>
      (farmers.data ?? []).filter(
        (farmer) =>
          (language === 'all' || farmer.user.preferred_language === language) &&
          (village === 'all' || farmer.user.village === village) &&
          matchesSearch(query, farmer.user.full_name, farmer.user.phone, farmer.user.email, farmer.user.village, farmer.user.district),
      ),
    [farmers.data, language, village, query],
  );

  const totals = useMemo(() => {
    const all = farmers.data ?? [];
    return {
      count: all.length,
      listedKg: all.reduce((sum, farmer) => sum + farmer.listed_kg, 0),
      lifetimeNet: all.reduce((sum, farmer) => sum + farmer.lifetime_net, 0),
      active: all.filter((farmer) => farmer.active_harvests > 0).length,
    };
  }, [farmers.data]);

  const kpis: KpiItem[] = [
    { id: 'count', icon: <Users strokeWidth={1.25} />, label: t('farmers.kpi.count', { defaultValue: 'Farmers' }), value: formatNumber(totals.count) },
    {
      id: 'active',
      icon: <Sprout strokeWidth={1.25} />,
      label: t('farmers.kpi.active', { defaultValue: 'With a live harvest' }),
      value: formatNumber(totals.active),
    },
    { id: 'listed', label: t('farmers.kpi.listed', { defaultValue: 'Listed now' }), value: <Quantity kg={totals.listedKg} size="xl" /> },
    {
      id: 'net',
      label: t('farmers.kpi.net', { defaultValue: 'Paid to farmers, net' }),
      value: <Money value={totals.lifetimeNet} compact size="xl" className="text-ink" />,
    },
  ];

  const languageName = (code: Language) => LANGUAGES.find((option) => option.code === code)?.native ?? code;

  const columns: DataTableColumn<FarmerSummary>[] = [
    {
      id: 'farmer',
      header: t('farmers.columns.farmer', { defaultValue: 'Farmer' }),
      sortValue: (farmer) => farmer.user.full_name,
      cell: (farmer) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={farmer.user.full_name} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-ink">{farmer.user.full_name}</span>
            <span className="truncate text-xs text-muted">{farmer.user.phone ?? farmer.user.email ?? '—'}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'village',
      header: t('farmers.columns.village', { defaultValue: 'Village' }),
      hideBelow: 'sm',
      sortValue: (farmer) => farmer.user.village,
      cell: (farmer) => (
        <span className="flex flex-col">
          <span className="text-ink/85">{farmer.user.village ?? '—'}</span>
          {farmer.user.district ? <span className="text-xs text-muted">{farmer.user.district}</span> : null}
        </span>
      ),
    },
    {
      id: 'language',
      header: t('farmers.columns.language', { defaultValue: 'Language' }),
      hideBelow: 'md',
      sortValue: (farmer) => farmer.user.preferred_language,
      cell: (farmer) => (
        <Badge tone="neutral" size="sm">
          <span lang={farmer.user.preferred_language}>{languageName(farmer.user.preferred_language)}</span>
        </Badge>
      ),
    },
    {
      id: 'active',
      header: t('farmers.columns.active', { defaultValue: 'Active harvests' }),
      numeric: true,
      hideBelow: 'lg',
      sortFirst: 'desc',
      sortValue: (farmer) => farmer.active_harvests,
      cell: (farmer) => <span className="tabular-nums">{formatNumber(farmer.active_harvests)}</span>,
    },
    {
      id: 'listed',
      header: t('farmers.columns.listed', { defaultValue: 'Listed' }),
      numeric: true,
      sortFirst: 'desc',
      sortValue: (farmer) => farmer.listed_kg,
      cell: (farmer) =>
        farmer.listed_kg > 0 ? <Quantity kg={farmer.listed_kg} size="sm" /> : <span className="text-muted">—</span>,
    },
    {
      id: 'net',
      header: t('farmers.columns.net', { defaultValue: 'Lifetime net' }),
      numeric: true,
      sortFirst: 'desc',
      sortValue: (farmer) => farmer.lifetime_net,
      cell: (farmer) =>
        farmer.lifetime_net > 0 ? (
          <Money value={farmer.lifetime_net} size="sm" className="text-forest-800" />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'last',
      header: t('farmers.columns.lastActivity', { defaultValue: 'Last activity' }),
      hideBelow: 'lg',
      sortFirst: 'desc',
      sortValue: (farmer) => (farmer.last_activity_at ? new Date(farmer.last_activity_at).getTime() : null),
      cell: (farmer) =>
        farmer.last_activity_at ? (
          <time dateTime={farmer.last_activity_at} title={formatDateTime(farmer.last_activity_at, { locale })} className="text-sm text-muted">
            {formatRelative(farmer.last_activity_at, { now, locale })}
          </time>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('farmers.columns.actions', { defaultValue: 'Actions' })}</span>,
      align: 'right',
      cell: (farmer) => (
        <LinkButton
          to={`/app/coordinator/harvests/new?farmer_id=${farmer.user.id}`}
          variant="secondary"
          size="sm"
          onClick={(event) => event.stopPropagation()}
          leadingIcon={<Mic aria-hidden="true" strokeWidth={1.25} />}
          aria-label={t('farmers.listFor', { defaultValue: 'List a harvest for {{name}}', name: farmer.user.full_name })}
        >
          <span className="hidden xl:inline">{t('farmers.listHarvest', { defaultValue: 'List harvest' })}</span>
        </LinkButton>
      ),
    },
  ];

  const activeFilters = (language === 'all' ? 0 : 1) + (village === 'all' ? 0 : 1);

  return (
    <div className="flex flex-col gap-8">
      <Seo
        title={t('farmers.seoTitle', { defaultValue: 'Farmers' })}
        description={t('farmers.seoDescription', { defaultValue: 'Farmers in your FPO with their active harvests and lifetime earnings.' })}
        path="/app/coordinator/farmers"
        noindex
      />
      <Reveal>
        <PageHeader
          eyebrow={t('farmers.eyebrow', { defaultValue: 'Your FPO' })}
          title={t('farmers.title', { defaultValue: 'Farmers' })}
          description={t('farmers.description', {
            defaultValue: 'Everyone you sell for: what they have listed today and what MandiMate has paid them, net of every cost.',
          })}
          actions={
            <LinkButton to="/app/coordinator/farmers/new" leadingIcon={<UserPlus aria-hidden="true" strokeWidth={1.25} />}>
              {t('farmers.register', { defaultValue: 'Register a farmer' })}
            </LinkButton>
          }
        />
      </Reveal>

      <KpiStrip items={kpis} loading={farmers.isPending} />

      <div className="flex flex-col gap-4">
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('farmers.searchPlaceholder', { defaultValue: 'Name, phone or village' })}
          searchLabel={t('farmers.searchLabel', { defaultValue: 'Search farmers' })}
          activeCount={activeFilters}
          onClear={() => {
            setSearch('');
            setLanguage('all');
            setVillage('all');
          }}
          resultLabel={
            farmers.data
              ? t('farmers.resultCount', {
                  defaultValue_one: '{{count}} farmer',
                  defaultValue_other: '{{count}} farmers',
                  count: rows.length,
                })
              : undefined
          }
        >
          <Select
            size="sm"
            aria-label={t('farmers.filterLanguage', { defaultValue: 'Language' })}
            value={language}
            onChange={(event) => setLanguage(event.target.value as LanguageFilter)}
            wrapperClassName="w-full sm:w-44"
          >
            <option value="all">{t('farmers.allLanguages', { defaultValue: 'All languages' })}</option>
            {LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.native}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label={t('farmers.filterVillage', { defaultValue: 'Village' })}
            value={village}
            onChange={(event) => setVillage(event.target.value)}
            wrapperClassName="w-full sm:w-52"
          >
            <option value="all">{t('farmers.allVillages', { defaultValue: 'All villages' })}</option>
            {villages.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </FilterBar>

        {farmers.isError ? (
          <QueryState query={farmers}>{() => null}</QueryState>
        ) : (
          <DataTable
            label={t('farmers.tableLabel', { defaultValue: 'Farmer roster' })}
            columns={columns}
            rows={farmers.isPending ? undefined : rows}
            getRowId={(farmer) => farmer.user.id}
            defaultSort={{ columnId: 'farmer', direction: 'asc' }}
            onRowClick={(farmer) => navigate(`/app/coordinator/harvests?farmer_id=${farmer.user.id}`)}
            empty={
              (farmers.data?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <p className="font-display text-h3 font-bold text-ink">{t('farmers.emptyTitle', { defaultValue: 'No farmers yet' })}</p>
                  <p className="max-w-sm text-sm font-normal text-ink-2">
                    {t('farmers.emptyBody', {
                      defaultValue: 'Register the first farmer of your FPO — it takes a minute, and they get a password to sign in.',
                    })}
                  </p>
                  <LinkButton to="/app/coordinator/farmers/new" size="sm" leadingIcon={<UserPlus aria-hidden="true" strokeWidth={1.25} />}>
                    {t('farmers.register', { defaultValue: 'Register a farmer' })}
                  </LinkButton>
                </div>
              ) : undefined
            }
            emptyTitle={t('farmers.noMatchesTitle', { defaultValue: 'No farmers match' })}
            emptyDescription={t('farmers.noMatchesBody', { defaultValue: 'Try another name, or clear the filters.' })}
            caption={<span className="text-xs text-muted">{t('farmers.caption', { defaultValue: 'Open a farmer to see their harvests.' })}</span>}
          />
        )}
      </div>
    </div>
  );
}
