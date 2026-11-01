import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable, FilterBar, PageHeader, type DataTableColumn , useUiLanguage } from '@/components/domain';
import { Badge, Button, EmptyState, Select } from '@/components/ui';
import { useAuditLog } from '@/features/admin/hooks';
import { isApiError } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { AuditEntry } from '@/types/api';
import { ScrollText } from 'lucide-react';

const humanize = (s: string) => s.replace(/[._]/g, ' ');

export default function AuditLogPage() {
  const { t } = useTranslation('admin');
  const lang = useUiLanguage();
  const locale = lang;
  const query = useAuditLog({ limit: 500 });
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');

  const entities = useMemo(() => [...new Set((query.data ?? []).map((e) => e.entity_type))].sort(), [query.data]);
  const actions = useMemo(
    () => [...new Set((query.data ?? []).filter((e) => !entity || e.entity_type === entity).map((e) => e.action))].sort(),
    [query.data, entity],
  );

  const rows = useMemo(() => {
    if (!query.data) return undefined;
    const needle = search.trim().toLowerCase();
    return query.data.filter(
      (e) =>
        (!entity || e.entity_type === entity) &&
        (!action || e.action === action) &&
        (!needle ||
          [e.summary, e.actor_name ?? '', e.action, e.entity_type, e.entity_id ?? ''].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [query.data, search, entity, action]);

  const columns: DataTableColumn<AuditEntry>[] = [
    {
      id: 'when',
      header: t('audit.when', { defaultValue: 'When' }),
      sortValue: (e) => e.created_at,
      sortFirst: 'desc',
      cell: (e) => (
        <time dateTime={e.created_at} className="block whitespace-nowrap tabular-nums">
          <span className="block text-ink">{formatDate(e.created_at, { locale })}</span>
          <span className="block text-xs text-muted">{formatTime(e.created_at, { locale })}</span>
        </time>
      ),
    },
    {
      id: 'actor',
      header: t('audit.actor', { defaultValue: 'Actor' }),
      sortValue: (e) => (e.actor_name ?? '').toLowerCase(),
      cell: (e) => <span className="text-ink">{e.actor_name ?? t('audit.system', { defaultValue: 'System' })}</span>,
    },
    {
      id: 'action',
      header: t('audit.action', { defaultValue: 'Action' }),
      sortValue: (e) => e.action,
      cell: (e) => (
        <Badge tone="neutral" size="sm" className="font-mono">
          {e.action}
        </Badge>
      ),
    },
    {
      id: 'entity',
      header: t('audit.entity', { defaultValue: 'Record' }),
      hideBelow: 'md',
      sortValue: (e) => e.entity_type,
      cell: (e) => (
        <span className="text-ink-2">
          <span className="capitalize">{humanize(e.entity_type)}</span>
          {e.entity_id ? <span className="ms-1.5 font-mono text-[11px] text-muted">{e.entity_id.slice(0, 8)}</span> : null}
        </span>
      ),
    },
    {
      id: 'summary',
      header: t('audit.summary', { defaultValue: 'What happened' }),
      cell: (e) => <span className="block min-w-[14rem] text-ink-2">{e.summary}</span>,
    },
  ];

  const activeCount = (search ? 1 : 0) + (entity ? 1 : 0) + (action ? 1 : 0);

  return (
    <div className="space-y-8">
      <Seo
        title={t('audit.seoTitle', { defaultValue: 'Audit log' })}
        description={t('audit.description', { defaultValue: 'Every consequential action, who took it and when.' })}
        path="/app/admin/audit"
        noindex
      />
      <PageHeader
        breadcrumbs={[{ label: t('home.title', { defaultValue: 'Admin overview' }), to: '/app/admin' }, { label: t('audit.title', { defaultValue: 'Audit log' }) }]}
        eyebrow={t('audit.eyebrow', { defaultValue: 'Ledger' })}
        title={t('audit.title', { defaultValue: 'Audit log' })}
        description={t('audit.description', { defaultValue: 'Every consequential action, who took it and when.' })}
        divider
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('audit.searchPlaceholder', { defaultValue: 'Search summary, actor or record' })}
        searchLabel={t('audit.search', { defaultValue: 'Search the audit log' })}
        activeCount={activeCount}
        onClear={() => {
          setSearch('');
          setEntity('');
          setAction('');
        }}
        resultLabel={rows ? t('audit.count', { defaultValue: '{{count}} entries', count: rows.length }) : undefined}
      >
        <Select
          aria-label={t('audit.filterEntity', { defaultValue: 'Record type' })}
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setAction('');
          }}
          size="sm"
        >
          <option value="">{t('audit.allEntities', { defaultValue: 'All records' })}</option>
          {entities.map((v) => (
            <option key={v} value={v}>
              {humanize(v)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('audit.filterAction', { defaultValue: 'Action' })} value={action} onChange={(e) => setAction(e.target.value)} size="sm">
          <option value="">{t('audit.allActions', { defaultValue: 'All actions' })}</option>
          {actions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </FilterBar>

      {query.isError ? (
        <EmptyState
          icon={<ScrollText aria-hidden="true" strokeWidth={1.25} />}
          title={t('audit.error', { defaultValue: 'Could not load the audit log' })}
          description={isApiError(query.error) ? query.error.detail : undefined}
          action={<Button variant="secondary" onClick={() => void query.refetch()}>{t('common:actions.retry', { defaultValue: 'Try again' })}</Button>}
        />
      ) : (
        <DataTable
          label={t('audit.tableLabel', { defaultValue: 'Audit log entries' })}
          columns={columns}
          rows={rows}
          loading={query.isPending}
          getRowId={(e) => e.id}
          defaultSort={{ columnId: 'when', direction: 'desc' }}
          emptyTitle={activeCount ? t('audit.emptyFiltered', { defaultValue: 'No entries match' }) : t('audit.emptyTitle', { defaultValue: 'Nothing recorded yet' })}
          emptyDescription={
            activeCount
              ? t('audit.emptyFilteredBody', { defaultValue: 'Try a different search or clear the filters.' })
              : t('audit.emptyBody', { defaultValue: 'Verifications, consents, settlements and other consequential actions appear here.' })
          }
          framed
        />
      )}
    </div>
  );
}
