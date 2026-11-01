import { BadgeCheck, Building2, Mail, MapPin, Phone, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { Avatar, Badge, Button, Card, Dialog, Field, SegmentedControl, Textarea, toast } from '@/components/ui';
import { useAdminUsers, useVerifyUser } from '@/features/coordinator-ops/hooks';
import { errorMessage } from '@/features/coordinator-ops/utils';
import { formatRelative } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { User, VerifyUserRequest } from '@/types/api';

type RoleFilter = 'all' | 'buyer' | 'transporter';
type Decision = { user: User; status: VerifyUserRequest['status'] };

const PARAMS = { verification_status: 'pending', limit: 200 } as const;

export default function VerificationsPage() {
  const { t } = useTranslation('coordinatorOps');
  const [role, setRole] = useState<RoleFilter>('all');
  const [decision, setDecision] = useState<Decision | null>(null);
  const users = useAdminUsers(PARAMS);

  const pending = useMemo(
    () => (users.data ?? []).filter((u) => (u.role === 'buyer' || u.role === 'transporter') && u.verification_status === 'pending'),
    [users.data],
  );
  const rows = role === 'all' ? pending : pending.filter((u) => u.role === role);
  const buyers = pending.filter((u) => u.role === 'buyer').length;

  return (
    <div className="space-y-10">
      <Seo
        title={t('verify.seoTitle', { defaultValue: 'Verifications' })}
        description={t('verify.description', { defaultValue: 'Buyers and transporters waiting to be verified.' })}
        path="/app/coordinator/verifications"
        noindex
      />
      <PageHeader
        eyebrow={t('eyebrow', { defaultValue: 'Back office' })}
        title={t('verify.title', { defaultValue: 'Verifications' })}
        description={t('verify.lede', {
          defaultValue: 'Only verified buyers can bid on farmers’ lots, and only verified transporters carry them. Check each one with care.',
        })}
        actions={
          <SegmentedControl<RoleFilter>
            label={t('verify.filter', { defaultValue: 'Show' })}
            size="sm"
            value={role}
            onValueChange={setRole}
            options={[
              { value: 'all', label: t('verify.all', { defaultValue: 'All ({{count}})', count: pending.length }) },
              { value: 'buyer', label: t('verify.buyers', { defaultValue: 'Buyers ({{count}})', count: buyers }) },
              { value: 'transporter', label: t('verify.transporters', { defaultValue: 'Transporters ({{count}})', count: pending.length - buyers }) },
            ]}
          />
        }
        divider
      />

      <QueryState
        query={users}
        skeleton="cards"
        isEmpty={() => rows.length === 0}
        empty={{
          title: t('verify.emptyTitle', { defaultValue: 'No one is waiting' }),
          description: t('verify.emptyBody', { defaultValue: 'New buyer and transporter sign-ups appear here for review.' }),
          icon: <ShieldCheck strokeWidth={1.25} aria-hidden />,
        }}
      >
        {() => (
          <StaggerGroup className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((user) => (
              <StaggerItem key={user.id}>
                <Card as="article" className="flex h-full flex-col gap-5 p-6" aria-labelledby={`user-${user.id}`}>
                  <div className="flex items-start gap-4">
                    <Avatar name={user.full_name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="eyebrow text-muted">
                        {t(`common:enums.role.${user.role}`, { defaultValue: user.role })}
                      </p>
                      <h2 id={`user-${user.id}`} className="truncate font-display font-bold text-h3 text-ink">
                        {user.full_name}
                      </h2>
                      <p className="text-micro text-muted">
                        {t('verify.joined', { defaultValue: 'Signed up {{when}}', when: formatRelative(user.created_at) })}
                      </p>
                    </div>
                    <Badge tone="warning" size="sm">
                      {t('common:enums.verificationStatus.pending', { defaultValue: 'Pending' })}
                    </Badge>
                  </div>
                  <ul className="space-y-2 border-t border-line/70 pt-4 text-small text-ink">
                    {user.organization_name ? (
                      <li className="flex items-center gap-2">
                        <Building2 strokeWidth={1.25} className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="truncate">{user.organization_name}</span>
                      </li>
                    ) : null}
                    {user.email ? (
                      <li className="flex items-center gap-2">
                        <Mail strokeWidth={1.25} className="size-4 shrink-0 text-muted" aria-hidden />
                        <a href={`mailto:${user.email}`} className="link-luxe truncate">{user.email}</a>
                      </li>
                    ) : null}
                    {user.phone ? (
                      <li className="flex items-center gap-2">
                        <Phone strokeWidth={1.25} className="size-4 shrink-0 text-muted" aria-hidden />
                        <a href={`tel:${user.phone}`} className="link-luxe">{user.phone}</a>
                      </li>
                    ) : null}
                    {user.district || user.state ? (
                      <li className="flex items-center gap-2">
                        <MapPin strokeWidth={1.25} className="size-4 shrink-0 text-muted" aria-hidden />
                        <span>{[user.village, user.district, user.state].filter(Boolean).join(', ')}</span>
                      </li>
                    ) : null}
                  </ul>
                  {user.verification_note ? <p className="text-small text-muted">“{user.verification_note}”</p> : null}
                  <div className="mt-auto flex gap-2">
                    <Button variant="secondary" fullWidth onClick={() => setDecision({ user, status: 'rejected' })} leadingIcon={<XCircle strokeWidth={1.25} aria-hidden />}>
                      {t('verify.reject', { defaultValue: 'Reject' })}
                    </Button>
                    <Button fullWidth onClick={() => setDecision({ user, status: 'verified' })} leadingIcon={<BadgeCheck strokeWidth={1.25} aria-hidden />}>
                      {t('verify.approve', { defaultValue: 'Verify' })}
                    </Button>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </QueryState>

      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

function DecisionDialog({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const { t } = useTranslation('coordinatorOps');
  const verify = useVerifyUser();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const key = decision ? `${decision.user.id}:${decision.status}` : null;
  if (key !== lastId) {
    setLastId(key);
    setNote('');
    setError(null);
  }

  const rejecting = decision?.status === 'rejected';

  const submit = () => {
    if (!decision) return;
    const text = note.trim();
    if (rejecting && text.length < 5) {
      setError(t('verify.noteRequired', { defaultValue: 'Tell them why, so they can fix it and reapply.' }));
      return;
    }
    verify.mutate(
      { id: decision.user.id, req: { status: decision.status, note: text || null } },
      {
        onSuccess: (user) => {
          toast.success(
            decision.status === 'verified'
              ? t('verify.toastVerified', { defaultValue: '{{name}} is verified', name: user.full_name })
              : t('verify.toastRejected', { defaultValue: '{{name}} was not verified', name: user.full_name }),
          );
          onClose();
        },
        onError: (err) => {
          const fieldError = (err as { fieldErrors?: Record<string, string> }).fieldErrors?.note;
          if (fieldError) setError(fieldError);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog
      open={decision !== null}
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      dismissible={!verify.isPending}
      title={
        rejecting
          ? t('verify.rejectTitle', { defaultValue: 'Reject {{name}}?', name: decision?.user.full_name ?? '' })
          : t('verify.approveTitle', { defaultValue: 'Verify {{name}}?', name: decision?.user.full_name ?? '' })
      }
      description={
        rejecting
          ? t('verify.rejectBody', { defaultValue: 'They will not be able to trade until they reapply.' })
          : t('verify.approveBody', { defaultValue: 'They will be able to trade on MandiMate straight away.' })
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={verify.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant={rejecting ? 'danger' : 'primary'} onClick={submit} loading={verify.isPending}>
            {rejecting ? t('verify.reject', { defaultValue: 'Reject' }) : t('verify.approve', { defaultValue: 'Verify' })}
          </Button>
        </>
      }
    >
      <Field
        label={t('verify.note', { defaultValue: 'Note' })}
        hint={rejecting ? t('verify.noteHintReject', { defaultValue: 'Shared with the applicant.' }) : t('verify.noteHint', { defaultValue: 'Optional — what you checked (GST, licence, call).' })}
        error={error ?? undefined}
        required={rejecting}
        optional={!rejecting}
      >
        <Textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            if (error) setError(null);
          }}
          rows={3}
          maxLength={500}
        />
      </Field>
    </Dialog>
  );
}
