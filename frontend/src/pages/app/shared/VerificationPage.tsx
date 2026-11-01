import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, CircleX, FileText, Handshake, Hourglass, ShieldCheck, Sprout, Wallet } from 'lucide-react';

import { PageHeader, SectionCard, StatusBadge } from '@/components/domain';
import { Button, EmptyState, Field, Skeleton, Textarea, toast } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { FormAlert } from '@/features/shared/components/FormAlert';
import { apiErrorMessage, applyFieldErrors } from '@/features/shared/forms';
import { useRequestVerification } from '@/features/shared/hooks';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Seo } from '@/lib/seo';
import type { User } from '@/types/api';

const schema = z.object({
  documents_note: z
    .string()
    .trim()
    .min(10, 'List the documents you can share (at least 10 characters)')
    .max(2000, 'Keep it under 2000 characters'),
});
type Values = z.infer<typeof schema>;

export default function VerificationPage() {
  const { t } = useTranslation('shared');
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <Seo
        title={t('verification.seoTitle', { defaultValue: 'Verification' })}
        description={t('verification.description', {
          defaultValue: 'Share your business documents so farmers can trade with you as a verified partner.',
        })}
        path="/app/verification"
        noindex
      />
      <PageHeader
        eyebrow={t('verification.eyebrow', { defaultValue: 'Trust' })}
        title={t('verification.title', { defaultValue: 'Verification' })}
        description={t('verification.description', {
          defaultValue: 'Share your business documents so farmers can trade with you as a verified partner.',
        })}
        meta={user ? <StatusBadge kind="verification" value={user.verification_status} /> : null}
        divider
      />
      {!user ? (
        <Skeleton className="h-80 rounded-card" />
      ) : user.role !== 'buyer' && user.role !== 'transporter' ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden="true" strokeWidth={1.25} />}
          title={t('verification.notNeeded', { defaultValue: 'No verification needed' })}
          description={t('verification.notNeededBody', {
            defaultValue: 'Verification applies to buyers and transporters. Your account is ready to use.',
          })}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Reveal>
            <StatusPanel user={user} />
          </Reveal>
          <Reveal delay={0.06}>
            <WhyItMatters role={user.role} />
          </Reveal>
        </div>
      )}
    </div>
  );
}

function StatusPanel({ user }: { user: User }) {
  const { t } = useTranslation('shared');
  const status = user.verification_status;

  if (status === 'verified') {
    return (
      <div className="relative overflow-hidden rounded-panel bg-forest-900 p-8 text-ivory sm:p-12">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-gold-400">
          <BadgeCheck className="size-4" strokeWidth={1.25} aria-hidden="true" />
          {t('verification.verifiedEyebrow', { defaultValue: 'Verified' })}
        </p>
        <h2 className="relative mt-6 font-display text-4xl font-bold leading-tight">{t('verification.verifiedTitle', { defaultValue: 'You are a verified partner' })}</h2>
        <p className="relative mt-4 max-w-prose text-[15px] font-normal leading-relaxed text-ivory/75">
          {t('verification.verifiedBody', {
            defaultValue: 'Farmers and coordinators see the verified mark beside your name on every offer and trip. Keep your details current in Settings.',
          })}
        </p>
        {user.verification_note ? (
          <p className="relative mt-8 border-t border-ivory/15 pt-4 text-xs text-ivory/60">{user.verification_note}</p>
        ) : null}
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <SectionCard
        eyebrow={t('verification.pendingEyebrow', { defaultValue: 'In review' })}
        title={t('verification.pendingTitle', { defaultValue: 'We are checking your documents' })}
        description={t('verification.pendingBody', {
          defaultValue: 'An administrator usually reviews requests within one working day. You can keep trading meanwhile; farmers will see you as pending.',
        })}
      >
        <div className="flex items-start gap-4 border-s border-gold-700 py-1 ps-5">
          <Hourglass className="mt-0.5 size-5 shrink-0 text-gold-700" strokeWidth={1.25} aria-hidden="true" />
          <div className="text-sm leading-relaxed text-ink-2">
            <p className="text-[13px] font-semibold text-ink">{t('verification.whatYouSent', { defaultValue: 'What you shared' })}</p>
            <p className="mt-1 whitespace-pre-line">{user.verification_note ?? t('verification.noNote', { defaultValue: 'Your documents note is with the reviewer.' })}</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      eyebrow={status === 'rejected' ? t('verification.rejectedEyebrow', { defaultValue: 'Needs another look' }) : t('verification.requestEyebrow', { defaultValue: 'Request verification' })}
      title={
        status === 'rejected'
          ? t('verification.rejectedTitle', { defaultValue: 'Your last request was not approved' })
          : t('verification.requestTitle', { defaultValue: 'Tell us about your business documents' })
      }
      description={t('verification.requestBody', {
        defaultValue: 'List the documents you can share — GSTIN, FSSAI or APMC licence for buyers; RC book, permit and insurance for transporters. An administrator may call to confirm.',
      })}
    >
      {status === 'rejected' && user.verification_note ? (
        <FormAlert tone="warning" title={t('verification.reviewerNote', { defaultValue: 'Reviewer’s note' })} live={false} className="mb-6">
          {user.verification_note}
        </FormAlert>
      ) : null}
      <RequestForm role={user.role} />
    </SectionCard>
  );
}

function RequestForm({ role }: { role: User['role'] }) {
  const { t } = useTranslation('shared');
  const request = useRequestVerification();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { documents_note: '' },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    request.mutate(values, {
      onSuccess: () => toast.success(t('verification.sent', { defaultValue: 'Request sent. We will let you know once it is reviewed.' })),
      onError: (error) => {
        const applied = applyFieldErrors(error, setError, { fields: ['documents_note'] });
        if (applied.length === 0) setFormError(apiErrorMessage(error, t));
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError ? <FormAlert title={t('verification.failed', { defaultValue: 'Could not send your request' })}>{formError}</FormAlert> : null}
      <Field
        label={t('verification.documents', { defaultValue: 'Documents you can provide' })}
        hint={
          role === 'transporter'
            ? t('verification.hintTransporter', { defaultValue: 'e.g. RC book KA-01-AB-1234, goods-carriage permit, valid insurance until March.' })
            : t('verification.hintBuyer', { defaultValue: 'e.g. GSTIN 29ABCDE1234F1Z5, FSSAI licence, APMC trader licence.' })
        }
        error={formState.errors.documents_note?.message}
        required
      >
        <Textarea rows={6} {...register('documents_note')} />
      </Field>
      <div className="flex items-center justify-between gap-4 border-t border-line pt-5">
        <p className="inline-flex items-center gap-2 text-xs text-muted">
          <FileText className="size-3.5" strokeWidth={1.25} aria-hidden="true" />
          {t('verification.privacy', { defaultValue: 'Only MandiMate administrators see this note.' })}
        </p>
        <Button type="submit" loading={request.isPending}>
          {t('verification.submit', { defaultValue: 'Request verification' })}
        </Button>
      </div>
    </form>
  );
}

function WhyItMatters({ role }: { role: User['role'] }) {
  const { t } = useTranslation('shared');
  const items = [
    {
      icon: Sprout,
      title: t('verification.why1Title', { defaultValue: 'Farmers trust you first' }),
      body:
        role === 'transporter'
          ? t('verification.why1Transporter', { defaultValue: 'Coordinators assign pooled pickups to verified transporters before anyone else.' })
          : t('verification.why1Buyer', { defaultValue: 'Farmers weigh offers by who is buying. A verified mark raises your acceptance rate.' }),
    },
    {
      icon: Wallet,
      title: t('verification.why2Title', { defaultValue: 'Payment certainty' }),
      body: t('verification.why2Body', {
        defaultValue: 'Verified partners carry a lower payment-delay risk in every farmer’s net earnings comparison.',
      }),
    },
    {
      icon: Handshake,
      title: t('verification.why3Title', { defaultValue: 'Fair recourse' }),
      body: t('verification.why3Body', { defaultValue: 'If a dispute arises, verified records make it faster to resolve for everyone.' }),
    },
  ];
  return (
    <aside className="rounded-card border border-line bg-paper p-6 sm:p-8">
      <p className="eyebrow eyebrow-rule">
        {t('verification.whyEyebrow', { defaultValue: 'Why it matters' })}
      </p>
      <ul className="mt-5 space-y-5">
        {items.map((item, i) => (
          <li key={item.title} className={cn('flex gap-4', i > 0 && 'border-t border-line pt-5')}>
            <span aria-hidden="true" className="w-6 shrink-0 font-display text-lg not-italic leading-snug text-gold-700 tabular-nums">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="flex items-center gap-2 font-display text-xl font-bold leading-snug text-ink">
                <item.icon className="size-4 shrink-0 text-muted" strokeWidth={1.25} aria-hidden="true" />
                {item.title}
              </p>
              <p className="mt-1 text-sm font-normal leading-relaxed text-ink-2">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex items-center gap-2 border-t border-line pt-4 text-xs text-muted">
        <CircleX className="size-3.5" strokeWidth={1.25} aria-hidden="true" />
        {t('verification.rejectNote', { defaultValue: 'If a request is rejected, the reviewer explains why and you can apply again.' })}
      </p>
    </aside>
  );
}
