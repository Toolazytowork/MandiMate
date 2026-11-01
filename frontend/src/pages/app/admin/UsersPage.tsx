import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ShieldCheck, Users } from 'lucide-react';

import { DataTable, FilterBar, PageHeader, StatusBadge, type DataTableColumn , useUiLanguage } from '@/components/domain';
import { Avatar, Badge, Button, Dialog, EmptyState, Field, RadioCard, RadioCardGroup, Select, Textarea, toast } from '@/components/ui';
import { useAdminUsers, useVerifyUser } from '@/features/admin/hooks';
import { apiErrorMessage } from '@/features/shared/forms';
import { isApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useDebounce } from '@/lib/hooks';
import { Seo } from '@/lib/seo';
import type { Role, User, VerificationStatus } from '@/types/api';

const ROLES: Role[] = ['farmer', 'buyer', 'transporter', 'coordinator', 'admin'];
const STATUSES: VerificationStatus[] = ['unverified', 'pending', 'verified', 'rejected'];

function isRole(v: string | null): v is Role {
  return v !== null && (ROLES as string[]).includes(v);
}
function isStatus(v: string | null): v is VerificationStatus {
  return v !== null && (STATUSES as string[]).includes(v);
}

export default function UsersPage() {
  const { t } = useTranslation('admin');
  const lang = useUiLanguage();
  const [params, setParams] = useSearchParams();
  const roleParam = params.get('role');
  const statusParam = params.get('verification');
  const role = isRole(roleParam) ? roleParam : '';
  const status = isStatus(statusParam) ? statusParam : '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounce(search.trim(), 300);
  const [reviewing, setReviewing] = useState<User | null>(null);

  const query = useAdminUsers({ role: role || undefined, verification_status: status || undefined, q: q || undefined, limit: 200 });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const columns: DataTableColumn<User>[] = [
    {
      id: 'name',
      header: t('users.name', { defaultValue: 'Person' }),
      sortValue: (u) => u.full_name.toLowerCase(),
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={u.full_name} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-ink">{u.full_name}</p>
            <p className="truncate text-xs text-muted">{u.email ?? u.phone ?? '—'}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: t('users.role', { defaultValue: 'Role' }),
      sortValue: (u) => u.role,
      cell: (u) => <Badge tone={u.role === 'farmer' ? 'gold' : 'neutral'}>{t(`common:enums.role.${u.role}`, { defaultValue: u.role })}</Badge>,
    },
    {
      id: 'org',
      header: t('users.organisation', { defaultValue: 'Organisation' }),
      hideBelow: 'lg',
      sortValue: (u) => (u.organization_name ?? u.fpo_name ?? '').toLowerCase(),
      cell: (u) => <span className="text-ink-2">{u.organization_name ?? u.fpo_name ?? '—'}</span>,
    },
    {
      id: 'place',
      header: t('users.location', { defaultValue: 'Location' }),
      hideBelow: 'lg',
      cell: (u) => <span className="text-ink-2">{[u.district, u.state].filter(Boolean).join(', ') || '—'}</span>,
    },
    {
      id: 'status',
      header: t('users.verification', { defaultValue: 'Verification' }),
      sortValue: (u) => STATUSES.indexOf(u.verification_status),
      cell: (u) => <StatusBadge kind="verification" value={u.verification_status} size="sm" />,
    },
    {
      id: 'joined',
      header: t('users.joined', { defaultValue: 'Joined' }),
      hideBelow: 'md',
      sortValue: (u) => u.created_at,
      sortFirst: 'desc',
      cell: (u) => <span className="tabular-nums text-ink-2">{formatDate(u.created_at, { locale: lang })}</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('users.actions', { defaultValue: 'Actions' })}</span>,
      align: 'right',
      cell: (u) =>
        u.role === 'buyer' || u.role === 'transporter' ? (
          <Button
            size="sm"
            variant={u.verification_status === 'pending' ? 'primary' : 'secondary'}
            onClick={(e) => {
              e.stopPropagation();
              setReviewing(u);
            }}
          >
            {u.verification_status === 'pending' ? t('users.review', { defaultValue: 'Review' }) : t('users.change', { defaultValue: 'Change' })}
          </Button>
        ) : null,
    },
  ];

  const activeCount = (role ? 1 : 0) + (status ? 1 : 0) + (search ? 1 : 0);

  return (
    <div className="space-y-8">
      <Seo
        title={t('users.seoTitle', { defaultValue: 'Users' })}
        description={t('users.description', { defaultValue: 'Everyone on MandiMate, by role and verification status.' })}
        path="/app/admin/users"
        noindex
      />
      <PageHeader
        breadcrumbs={[{ label: t('home.title', { defaultValue: 'Admin overview' }), to: '/app/admin' }, { label: t('users.title', { defaultValue: 'Users' }) }]}
        eyebrow={t('home.eyebrow', { defaultValue: 'Administration' })}
        title={t('users.title', { defaultValue: 'Users' })}
        description={t('users.description', { defaultValue: 'Everyone on MandiMate, by role and verification status.' })}
        divider
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('users.searchPlaceholder', { defaultValue: 'Name, email, phone or organisation' })}
        searchLabel={t('users.search', { defaultValue: 'Search users' })}
        activeCount={activeCount}
        onClear={() => {
          setSearch('');
          setParams(new URLSearchParams(), { replace: true });
        }}
        resultLabel={query.data ? t('users.count', { defaultValue: '{{count}} people', count: query.data.length }) : undefined}
      >
        <Select
          aria-label={t('users.filterRole', { defaultValue: 'Role' })}
          value={role}
          onChange={(e) => setParam('role', e.target.value)}
          size="sm"
        >
          <option value="">{t('users.allRoles', { defaultValue: 'All roles' })}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`common:enums.role.${r}`, { defaultValue: r })}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('users.filterStatus', { defaultValue: 'Verification' })}
          value={status}
          onChange={(e) => setParam('verification', e.target.value)}
          size="sm"
        >
          <option value="">{t('users.allStatuses', { defaultValue: 'Any verification' })}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`common:enums.verificationStatus.${s}`, { defaultValue: s })}
            </option>
          ))}
        </Select>
      </FilterBar>

      {query.isError ? (
        <EmptyState
          icon={<Users aria-hidden="true" strokeWidth={1.25} />}
          title={t('users.error', { defaultValue: 'Could not load users' })}
          description={isApiError(query.error) ? query.error.detail : undefined}
          action={<Button variant="secondary" onClick={() => void query.refetch()}>{t('common:actions.retry', { defaultValue: 'Try again' })}</Button>}
        />
      ) : (
        <DataTable
          label={t('users.tableLabel', { defaultValue: 'Users' })}
          columns={columns}
          rows={query.data}
          loading={query.isPending}
          getRowId={(u) => u.id}
          defaultSort={{ columnId: 'joined', direction: 'desc' }}
          emptyTitle={t('users.emptyTitle', { defaultValue: 'No one matches' })}
          emptyDescription={t('users.emptyBody', { defaultValue: 'Try a different search or clear the filters.' })}
          rowClassName={(u) => (u.verification_status === 'pending' ? 'bg-gold-50/40' : undefined)}
          framed
        />
      )}

      <VerifyDialog user={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

function VerifyDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const verify = useVerifyUser();
  const [decision, setDecision] = useState<'verified' | 'rejected'>('verified');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [lastUserId, setLastUserId] = useState<string | null>(null);

  if (user && user.id !== lastUserId) {
    setLastUserId(user.id);
    setDecision(user.verification_status === 'verified' ? 'rejected' : 'verified');
    setNote('');
    setNoteError(null);
  }

  const submit = () => {
    if (!user) return;
    if (decision === 'rejected' && note.trim().length < 5) {
      setNoteError(t('users.noteRequired', { defaultValue: 'Explain why, so they can fix it and apply again.' }));
      return;
    }
    setNoteError(null);
    verify.mutate(
      { id: user.id, req: { status: decision, note: note.trim() || null } },
      {
        onSuccess: (u) => {
          toast.success(
            decision === 'verified'
              ? t('users.verifiedToast', { defaultValue: '{{name}} is now verified.', name: u.full_name })
              : t('users.rejectedToast', { defaultValue: 'Request from {{name}} rejected.', name: u.full_name }),
          );
          onClose();
        },
        onError: (error) => {
          if (isApiError(error) && error.fieldErrors.note) setNoteError(error.fieldErrors.note);
          else toast.error(apiErrorMessage(error, t));
        },
      },
    );
  };

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => (!open && !verify.isPending ? onClose() : undefined)}
      dismissible={!verify.isPending}
      title={t('users.verifyTitle', { defaultValue: 'Review verification' })}
      description={user ? `${user.full_name} · ${t(`common:enums.role.${user.role}`, { defaultValue: user.role })}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={verify.isPending}>
            {t('common:actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant={decision === 'rejected' ? 'danger' : 'primary'} onClick={submit} loading={verify.isPending}>
            {decision === 'verified' ? t('users.verify', { defaultValue: 'Verify' }) : t('users.reject', { defaultValue: 'Reject' })}
          </Button>
        </>
      }
    >
      {user ? (
        <div className="space-y-6">
          <dl className="grid gap-5 border-y border-line py-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[13px] font-semibold text-muted">{t('users.organisation', { defaultValue: 'Organisation' })}</dt>
              <dd className="mt-1 text-ink">{user.organization_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[13px] font-semibold text-muted">{t('users.contact', { defaultValue: 'Contact' })}</dt>
              <dd className="mt-1 break-words text-ink">{[user.email, user.phone].filter(Boolean).join(' · ') || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[13px] font-semibold text-muted">{t('users.documents', { defaultValue: 'Documents note' })}</dt>
              <dd className="mt-1 whitespace-pre-line text-ink-2">
                {user.verification_note ?? t('users.noDocuments', { defaultValue: 'No note on file.' })}
              </dd>
            </div>
          </dl>
          <RadioCardGroup
            label={t('users.decision', { defaultValue: 'Decision' })}
            value={decision}
            onValueChange={(v) => setDecision(v === 'rejected' ? 'rejected' : 'verified')}
            columns={2}
          >
            <RadioCard
              value="verified"
              icon={<ShieldCheck aria-hidden="true" strokeWidth={1.25} />}
              title={t('users.verify', { defaultValue: 'Verify' })}
              description={t('users.verifyHint', { defaultValue: 'Documents check out.' })}
            />
            <RadioCard
              value="rejected"
              title={t('users.reject', { defaultValue: 'Reject' })}
              description={t('users.rejectHint', { defaultValue: 'Something is missing or wrong.' })}
            />
          </RadioCardGroup>
          <Field
            label={t('users.note', { defaultValue: 'Note to the user' })}
            hint={t('users.noteHint', { defaultValue: 'Shown on their verification page.' })}
            error={noteError}
            required={decision === 'rejected'}
            optional={decision === 'verified'}
          >
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}
