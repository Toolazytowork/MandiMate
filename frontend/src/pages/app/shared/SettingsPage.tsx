import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Bot, Globe2, KeyRound, LogOut, MapPin, UserRound } from 'lucide-react';

import { AiModeNotice, PageHeader, SectionCard , useUiLanguage } from '@/components/domain';
import { Avatar, Badge, Button, Field, Input, SegmentedControl, Skeleton, toast } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { CoordinatesControl } from '@/features/shared/components/CoordinatesControl';
import { FormAlert } from '@/features/shared/components/FormAlert';
import { apiErrorMessage, applyFieldErrors, blankToNull, isValidEmail, isValidPhone, meetsPasswordPolicy } from '@/features/shared/forms';
import { useAiStatus, useChangePassword, useUpdateProfile } from '@/features/shared/hooks';
import { StateSuggestions } from '@/features/shared/indianStates';
import { useAuth } from '@/lib/auth';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Language, User } from '@/types/api';

/* ─────────────────────────────── Page ─────────────────────────────── */

export default function SettingsPage() {
  const { t } = useTranslation('shared');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      toast.error(t('common:errors.generic', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="space-y-8">
      <Seo
        title={t('settings.seoTitle', { defaultValue: 'Settings' })}
        description={t('settings.description', { defaultValue: 'Your profile, preferred language, location and password.' })}
        path="/app/settings"
        noindex
      />
      <PageHeader
        eyebrow={t('settings.eyebrow', { defaultValue: 'Account' })}
        title={t('settings.title', { defaultValue: 'Settings' })}
        description={t('settings.description', { defaultValue: 'Your profile, preferred language, location and password.' })}
        actions={
          <Button variant="secondary" leadingIcon={<LogOut aria-hidden="true" strokeWidth={1.25} />} onClick={signOut} loading={signingOut}>
            {t('settings.signOut', { defaultValue: 'Sign out' })}
          </Button>
        }
        divider
      />

      {user ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Reveal>
              <ProfileSection user={user} />
            </Reveal>
            <Reveal delay={0.06}>
              <LocationSection user={user} />
            </Reveal>
            <Reveal delay={0.12}>
              <PasswordSection />
            </Reveal>
          </div>
          <aside className="space-y-6">
            <IdentityCard user={user} />
            <LanguageSection user={user} />
            <AiSection />
          </aside>
        </div>
      ) : (
        <Skeleton className="h-96 rounded-card" />
      )}
    </div>
  );
}

/* ───────────────────────────── Identity ───────────────────────────── */

function IdentityCard({ user }: { user: User }) {
  const { t } = useTranslation('shared');
  const lang = useUiLanguage();
  return (
    <div className="relative overflow-hidden rounded-panel bg-forest-900 p-7 text-ivory">
      <div className="relative flex items-center gap-4">
        <Avatar name={user.full_name} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-display text-2xl font-bold">{user.full_name}</p>
          <p className="truncate text-sm font-normal text-ivory/65">{user.email ?? user.phone}</p>
        </div>
      </div>
      <dl className="relative mt-6 grid grid-cols-2 gap-4 border-t border-ivory/15 pt-5 text-sm">
        <div>
          <dt className="text-[13px] font-semibold text-gold-400">{t('settings.role', { defaultValue: 'Role' })}</dt>
          <dd className="mt-1">{t(`common:enums.role.${user.role}`, { defaultValue: user.role })}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-gold-400">{t('settings.memberSince', { defaultValue: 'Member since' })}</dt>
          <dd className="mt-1">{formatDate(user.created_at, { locale: lang })}</dd>
        </div>
        {user.role === 'buyer' || user.role === 'transporter' ? (
          <div className="col-span-2">
            <dt className="text-[13px] font-semibold text-gold-400">
              {t('settings.verification', { defaultValue: 'Verification' })}
            </dt>
            <dd className="mt-1.5">
              <Badge tone="glass" dot>
                {t(`common:enums.verificationStatus.${user.verification_status}`, { defaultValue: user.verification_status })}
              </Badge>
            </dd>
          </div>
        ) : null}
        {user.fpo_name ? (
          <div className="col-span-2">
            <dt className="text-[13px] font-semibold text-gold-400">{t('settings.fpo', { defaultValue: 'Producer organisation' })}</dt>
            <dd className="mt-1">{user.fpo_name}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/* ───────────────────────────── Profile ────────────────────────────── */

const profileSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full name').max(120, 'Keep it under 120 characters'),
    email: z.string().trim().max(254),
    phone: z.string().trim().max(32),
    organization_name: z.string().trim().max(160),
  })
  .superRefine((value, ctx) => {
    if (value.email && !isValidEmail(value.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address' });
    if (value.phone && !isValidPhone(value.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a 10–15 digit phone number' });
    if (!value.email && !value.phone) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Keep at least an email or a phone number' });
  });
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation('shared');
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const needsOrg = user.role === 'buyer' || user.role === 'transporter' || user.role === 'coordinator';
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: user.full_name,
      email: user.email ?? '',
      phone: user.phone ?? '',
      organization_name: user.organization_name ?? '',
    },
  });
  const { register, handleSubmit, formState, setError, reset } = form;

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    update.mutate(
      {
        full_name: values.full_name.trim(),
        email: blankToNull(values.email),
        phone: blankToNull(values.phone),
        ...(needsOrg ? { organization_name: blankToNull(values.organization_name) } : {}),
      },
      {
        onSuccess: (next) => {
          reset({ full_name: next.full_name, email: next.email ?? '', phone: next.phone ?? '', organization_name: next.organization_name ?? '' });
          toast.success(t('settings.profileSaved', { defaultValue: 'Profile saved.' }));
        },
        onError: (error) => {
          const applied = applyFieldErrors(error, setError, {
            fields: ['full_name', 'email', 'phone', 'organization_name'],
            codes: { email_taken: 'email', phone_taken: 'phone' },
          });
          if (applied.length === 0) setFormError(apiErrorMessage(error, t));
        },
      },
    );
  });

  return (
    <SectionCard
      eyebrow={<span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" strokeWidth={1.25} aria-hidden="true" />{t('settings.profileEyebrow', { defaultValue: 'Profile' })}</span>}
      title={t('settings.profileTitle', { defaultValue: 'How people know you' })}
      description={t('settings.profileBody', { defaultValue: 'Coordinators and buyers see your name; we use your phone or email for offers and payments.' })}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError ? <FormAlert title={t('settings.saveFailed', { defaultValue: 'Could not save your profile' })}>{formError}</FormAlert> : null}
        <Field label={t('settings.fullName', { defaultValue: 'Full name' })} error={formState.errors.full_name?.message} required>
          <Input autoComplete="name" {...register('full_name')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('settings.email', { defaultValue: 'Email' })} error={formState.errors.email?.message} optional>
            <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
          </Field>
          <Field label={t('settings.phone', { defaultValue: 'Phone' })} error={formState.errors.phone?.message} optional>
            <Input type="tel" autoComplete="tel" inputMode="tel" {...register('phone')} />
          </Field>
        </div>
        {needsOrg ? (
          <Field
            label={
              user.role === 'coordinator'
                ? t('settings.fpoName', { defaultValue: 'FPO name' })
                : t('settings.businessName', { defaultValue: 'Business name' })
            }
            error={formState.errors.organization_name?.message}
          >
            <Input autoComplete="organization" {...register('organization_name')} />
          </Field>
        ) : null}
        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
            {t('settings.saveProfile', { defaultValue: 'Save profile' })}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* ───────────────────────────── Location ───────────────────────────── */

const locationSchema = z.object({
  village: z.string().trim().max(120),
  district: z.string().trim().max(120),
  state: z.string().trim().max(120),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});
type LocationValues = z.infer<typeof locationSchema>;

function LocationSection({ user }: { user: User }) {
  const { t } = useTranslation('shared');
  const update = useUpdateProfile();
  const statesId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LocationValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      village: user.village ?? '',
      district: user.district ?? '',
      state: user.state ?? '',
      latitude: user.latitude,
      longitude: user.longitude,
    },
  });
  const { register, handleSubmit, formState, setError, reset, setValue, watch } = form;
  const latitude = watch('latitude');
  const longitude = watch('longitude');

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    update.mutate(
      {
        village: blankToNull(values.village),
        district: blankToNull(values.district),
        state: blankToNull(values.state),
        latitude: values.latitude,
        longitude: values.longitude,
      },
      {
        onSuccess: (next) => {
          reset({ village: next.village ?? '', district: next.district ?? '', state: next.state ?? '', latitude: next.latitude, longitude: next.longitude });
          toast.success(t('settings.locationSaved', { defaultValue: 'Location saved.' }));
        },
        onError: (error) => {
          const applied = applyFieldErrors(error, setError, { fields: ['village', 'district', 'state', 'latitude', 'longitude'] });
          if (applied.length === 0) setFormError(apiErrorMessage(error, t));
        },
      },
    );
  });

  return (
    <SectionCard
      eyebrow={<span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" strokeWidth={1.25} aria-hidden="true" />{t('settings.locationEyebrow', { defaultValue: 'Location' })}</span>}
      title={t('settings.locationTitle', { defaultValue: 'Where your harvest starts' })}
      description={t('settings.locationBody', {
        defaultValue: 'Your location sets transport distances, so the net you see after freight stays honest.',
      })}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError ? <FormAlert title={t('settings.saveFailed', { defaultValue: 'Could not save your profile' })}>{formError}</FormAlert> : null}
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={t('settings.village', { defaultValue: 'Village / town' })} error={formState.errors.village?.message}>
            <Input autoComplete="address-level3" {...register('village')} />
          </Field>
          <Field label={t('settings.district', { defaultValue: 'District' })} error={formState.errors.district?.message}>
            <Input autoComplete="address-level2" {...register('district')} />
          </Field>
          <Field label={t('settings.state', { defaultValue: 'State' })} error={formState.errors.state?.message}>
            <Input list={statesId} autoComplete="address-level1" {...register('state')} />
          </Field>
        </div>
        <StateSuggestions id={statesId} />
        <CoordinatesControl
          latitude={latitude}
          longitude={longitude}
          onChange={(coords) => {
            setValue('latitude', coords?.latitude ?? null, { shouldDirty: true });
            setValue('longitude', coords?.longitude ?? null, { shouldDirty: true });
          }}
        />
        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
            {t('settings.saveLocation', { defaultValue: 'Save location' })}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* ───────────────────────────── Password ───────────────────────────── */

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password'),
    new_password: z.string().refine(meetsPasswordPolicy, '8–128 characters with at least one letter and one number'),
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, { path: ['confirm'], message: 'The passwords do not match' })
  .refine((v) => v.new_password !== v.current_password, { path: ['new_password'], message: 'Choose a password you have not used here' });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const { t } = useTranslation('shared');
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError, reset } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: '', new_password: '', confirm: '' },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    change.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: () => {
          reset();
          toast.success(t('settings.passwordChanged', { defaultValue: 'Password changed.' }));
        },
        onError: (error) => {
          const applied = applyFieldErrors(error, setError, {
            fields: ['current_password', 'new_password'],
            codes: { invalid_password: 'current_password', wrong_password: 'current_password', invalid_credentials: 'current_password' },
          });
          if (applied.length === 0) setFormError(apiErrorMessage(error, t));
        },
      },
    );
  });

  return (
    <SectionCard
      eyebrow={<span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" strokeWidth={1.25} aria-hidden="true" />{t('settings.securityEyebrow', { defaultValue: 'Security' })}</span>}
      title={t('settings.passwordTitle', { defaultValue: 'Change password' })}
      description={t('settings.passwordBody', { defaultValue: 'At least 8 characters, with a letter and a number.' })}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError ? <FormAlert title={t('settings.passwordFailed', { defaultValue: 'Could not change your password' })}>{formError}</FormAlert> : null}
        <Field label={t('settings.currentPassword', { defaultValue: 'Current password' })} error={formState.errors.current_password?.message} required>
          <Input type="password" autoComplete="current-password" {...register('current_password')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('settings.newPassword', { defaultValue: 'New password' })} error={formState.errors.new_password?.message} required>
            <Input type="password" autoComplete="new-password" {...register('new_password')} />
          </Field>
          <Field label={t('settings.confirmPassword', { defaultValue: 'Confirm new password' })} error={formState.errors.confirm?.message} required>
            <Input type="password" autoComplete="new-password" {...register('confirm')} />
          </Field>
        </div>
        <div className="flex justify-end border-t border-line pt-5">
          <Button type="submit" loading={change.isPending}>
            {t('settings.updatePassword', { defaultValue: 'Update password' })}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* ───────────────────────────── Language ───────────────────────────── */

function LanguageSection({ user }: { user: User }) {
  const { t } = useTranslation('shared');
  const lang = useUiLanguage();
  const update = useUpdateProfile();
  const [value, setValue] = useState<Language>(user.preferred_language);
  useEffect(() => setValue(user.preferred_language), [user.preferred_language]);

  const choose = (lng: Language) => {
    const previous = value;
    setValue(lng);
    void setLanguage(lng);
    update.mutate(
      { preferred_language: lng },
      {
        onSuccess: () => toast.success(t('settings.languageSaved', { defaultValue: 'Language updated.', lng })),
        onError: (error) => {
          setValue(previous);
          void setLanguage(previous);
          toast.error(apiErrorMessage(error, t));
        },
      },
    );
  };

  return (
    <SectionCard
      eyebrow={<span className="inline-flex items-center gap-1.5"><Globe2 className="size-3.5" strokeWidth={1.25} aria-hidden="true" />{t('settings.languageEyebrow', { defaultValue: 'Language' })}</span>}
      title={t('settings.languageTitle', { defaultValue: 'Your language' })}
      description={t('settings.languageBody', { defaultValue: 'Screens, SMS and voice prompts use this language.' })}
    >
      <SegmentedControl<Language>
        label={t('settings.languageTitle', { defaultValue: 'Your language' })}
        value={value}
        onValueChange={choose}
        fullWidth
        options={LANGUAGES.map((l) => ({ value: l.code, label: <span lang={l.code}>{l.native}</span> }))}
      />
      <p className="mt-3 text-xs text-muted" aria-live="polite">
        {update.isPending
          ? t('settings.saving', { defaultValue: 'Saving…' })
          : LANGUAGES.find((l) => l.code === (lang as Language))?.label}
      </p>
    </SectionCard>
  );
}

/* ──────────────────────────────── AI ──────────────────────────────── */

function AiSection() {
  const { t } = useTranslation('shared');
  const status = useAiStatus();
  const live = status.data?.mode === 'live';
  return (
    <SectionCard
      eyebrow={<span className="inline-flex items-center gap-1.5"><Bot className="size-3.5" strokeWidth={1.25} aria-hidden="true" />{t('settings.aiEyebrow', { defaultValue: 'AI assistance' })}</span>}
      title={t('settings.aiTitle', { defaultValue: 'How MandiMate’s AI works' })}
    >
      {status.isPending ? (
        <Skeleton className="h-24 rounded-card" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={live ? 'forest' : 'neutral'} dot>
              {live ? t('settings.aiLive', { defaultValue: 'Live model' }) : t('settings.aiMock', { defaultValue: 'Rule-based mode' })}
            </Badge>
            {status.data?.model ? <span className="truncate text-xs text-muted">{status.data.model}</span> : null}
          </div>
          <p className="text-sm font-normal leading-relaxed text-ink-2">
            {live
              ? t('settings.aiLiveBody', {
                  defaultValue:
                    'Voice listings, deal advice and counter-offer suggestions are drafted by a language model. Every number it shows is computed by MandiMate, not guessed — and nothing is sent or accepted without you.',
                })
              : t('settings.aiMockBody', {
                  defaultValue:
                    'No AI model is connected, so suggestions come from transparent, deterministic rules. The net-earnings maths is identical either way.',
                })}
          </p>
          {status.data?.features.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {status.data.features.map((f) => (
                <li key={f}>
                  <Badge tone="neutral" size="sm">{f.replace(/_/g, ' ')}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <AiModeNotice status={status.data ?? null} />
        </div>
      )}
    </SectionCard>
  );
}
