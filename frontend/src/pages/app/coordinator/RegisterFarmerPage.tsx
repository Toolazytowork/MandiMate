import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Check, Copy, Eye, EyeOff, Mic, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { Badge, Button, Card, Field, Input, LinkButton, Select, toast } from '@/components/ui';
import { PageHeader, SectionCard } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { STATE_AP, VILLAGES } from '@/features/coordinator/constants';
import { useRegisterFarmer } from '@/features/coordinator/hooks';
import { applyFieldErrors, errorMessage } from '@/features/coordinator/utils';
import { LANGUAGES } from '@/lib/i18n';
import { Seo } from '@/lib/seo';
import type { Language, RegisteredFarmer, RegisterFarmerRequest } from '@/types/api';

const FIELDS = ['full_name', 'phone', 'email', 'village', 'district', 'state', 'preferred_language'] as const;

function useSchema() {
  const { t } = useTranslation('coordinator');
  return z.object({
    full_name: z.string().trim().min(2, t('register.errors.name', { defaultValue: 'Enter the farmer’s full name.' })),
    phone: z
      .string()
      .trim()
      .transform((value) => value.replace(/[\s-]/g, ''))
      .refine((value) => /^(\+91)?[6-9]\d{9}$/.test(value), t('register.errors.phone', { defaultValue: 'Enter a 10-digit mobile number.' })),
    email: z
      .string()
      .trim()
      .refine((value) => value === '' || z.email().safeParse(value).success, t('register.errors.email', { defaultValue: 'Enter a valid email or leave it blank.' })),
    village: z.string().trim().min(2, t('register.errors.village', { defaultValue: 'Enter the village.' })),
    district: z.string().trim().min(2, t('register.errors.district', { defaultValue: 'Enter the district.' })),
    state: z.string().trim().min(2, t('register.errors.state', { defaultValue: 'Enter the state.' })),
    preferred_language: z.enum(['en', 'hi', 'te', 'kn', 'ur']),
  });
}

type FormInput = z.input<ReturnType<typeof useSchema>>;
type FormOutput = z.output<ReturnType<typeof useSchema>>;

const DEFAULTS: FormInput = { full_name: '', phone: '', email: '', village: '', district: 'Annamayya', state: STATE_AP, preferred_language: 'te' };

export default function RegisterFarmerPage() {
  const { t } = useTranslation('coordinator');
  const schema = useSchema();
  const register = useRegisterFarmer();
  const [registered, setRegistered] = useState<RegisteredFarmer | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });
  const {
    formState: { errors },
  } = form;

  const onVillageChange = (value: string) => {
    const preset = VILLAGES.find((village) => village.name.toLowerCase() === value.trim().toLowerCase());
    if (preset) {
      form.setValue('district', preset.district, { shouldValidate: true });
      form.setValue('state', preset.state, { shouldValidate: true });
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    const preset = VILLAGES.find((village) => village.name.toLowerCase() === values.village.toLowerCase());
    const req: RegisterFarmerRequest = {
      ...values,
      email: values.email || null,
      latitude: preset?.latitude ?? null,
      longitude: preset?.longitude ?? null,
    };
    register.mutate(req, {
      onSuccess: (result) => {
        setRegistered(result);
        toast.success(t('register.toastSuccess', { defaultValue: '{{name}} is registered', name: result.user.full_name }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      onError: (error) => {
        const inline = applyFieldErrors(error, form.setError, FIELDS);
        toast.error(inline ? t('register.toastFix', { defaultValue: 'Check the highlighted fields.' }) : errorMessage(error));
      },
    });
  });

  const startOver = () => {
    setRegistered(null);
    form.reset(DEFAULTS);
  };

  const villageField = form.register('village');

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <Seo
        title={t('register.seoTitle', { defaultValue: 'Register a farmer' })}
        description={t('register.seoDescription', { defaultValue: 'Assisted onboarding for a farmer in your FPO.' })}
        path="/app/coordinator/farmers/new"
        noindex
      />
      <Reveal>
        <PageHeader
          eyebrow={t('register.eyebrow', { defaultValue: 'Assisted onboarding' })}
          title={t('register.title', { defaultValue: 'Register a farmer' })}
          description={t('register.description', {
            defaultValue: 'Create an account on the farmer’s behalf. They sign in with their phone number and the temporary password you hand them.',
          })}
          breadcrumbs={[
            { label: t('farmers.crumb', { defaultValue: 'Farmers' }), to: '/app/coordinator/farmers' },
            { label: t('register.crumb', { defaultValue: 'Register' }) },
          ]}
          divider
        />
      </Reveal>

      {registered ? (
        <HandoverCard farmer={registered} onAnother={startOver} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <SectionCard
            eyebrow={t('register.formEyebrow', { defaultValue: 'Farmer details' })}
            title={t('register.formTitle', { defaultValue: 'Name, phone and village' })}
          >
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('register.fullName', { defaultValue: 'Full name' })} error={errors.full_name?.message} required className="sm:col-span-2">
                  <Input autoComplete="off" placeholder="Ravi Kumar Reddy" {...form.register('full_name')} />
                </Field>
                <Field
                  label={t('register.phone', { defaultValue: 'Mobile number' })}
                  hint={t('register.phoneHint', { defaultValue: 'Their sign-in. Updates come by SMS.' })}
                  error={errors.phone?.message}
                  required
                >
                  <Input type="tel" inputMode="tel" autoComplete="off" leading="+91" placeholder="98765 43210" {...form.register('phone')} />
                </Field>
                <Field label={t('register.email', { defaultValue: 'Email' })} error={errors.email?.message} optional>
                  <Input type="email" autoComplete="off" {...form.register('email')} />
                </Field>
                <Field label={t('register.village', { defaultValue: 'Village' })} error={errors.village?.message} required>
                  <Input
                    list="coordinator-villages"
                    autoComplete="off"
                    {...villageField}
                    onChange={(event) => {
                      void villageField.onChange(event);
                      onVillageChange(event.target.value);
                    }}
                  />
                </Field>
                <datalist id="coordinator-villages">
                  {VILLAGES.map((village) => (
                    <option key={village.id} value={village.name} />
                  ))}
                </datalist>
                <Field label={t('register.district', { defaultValue: 'District' })} error={errors.district?.message} required>
                  <Input autoComplete="off" {...form.register('district')} />
                </Field>
                <Field label={t('register.state', { defaultValue: 'State' })} error={errors.state?.message} required>
                  <Input autoComplete="off" {...form.register('state')} />
                </Field>
                <Field
                  label={t('register.language', { defaultValue: 'Preferred language' })}
                  hint={t('register.languageHint', { defaultValue: 'Messages and voice listing use this language.' })}
                  error={errors.preferred_language?.message}
                  required
                >
                  <Select {...form.register('preferred_language')}>
                    {LANGUAGES.map((language) => (
                      <option key={language.code} value={language.code as Language}>
                        {language.label} · {language.native}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                <LinkButton to="/app/coordinator/farmers" variant="ghost">
                  {t('register.cancel', { defaultValue: 'Back to farmers' })}
                </LinkButton>
                <Button type="submit" loading={register.isPending} leadingIcon={<UserPlus aria-hidden="true" strokeWidth={1.25} />}>
                  {t('register.submit', { defaultValue: 'Register farmer' })}
                </Button>
              </div>
            </form>
          </SectionCard>

          <Card variant="parchment" as="aside" className="flex flex-col gap-6 p-6 sm:p-8">
            <p className="eyebrow eyebrow-rule">{t('register.howEyebrow', { defaultValue: 'How it works' })}</p>
            <ol className="flex flex-col">
              {[
                {
                  title: t('register.step1Title', { defaultValue: 'You create the account' }),
                  body: t('register.step1Body', { defaultValue: 'With the farmer beside you, in their language.' }),
                },
                {
                  title: t('register.step2Title', { defaultValue: 'Hand over the password' }),
                  body: t('register.step2Body', { defaultValue: 'Shown once. Write it down for them or read it aloud — never send it to anyone else.' }),
                },
                {
                  title: t('register.step3Title', { defaultValue: 'List their first harvest' }),
                  body: t('register.step3Body', { defaultValue: 'Speak it or type it — they see net earnings before agreeing to anything.' }),
                },
              ].map((step, index) => (
                <li key={step.title} className="flex gap-5 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0">
                  <span aria-hidden="true" className="w-8 shrink-0 font-display text-2xl font-bold not-italic leading-none tabular-nums text-gold-700">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <p className="font-display text-lg font-normal leading-snug text-ink">{step.title}</p>
                    <p className="text-sm font-normal leading-relaxed text-ink-2">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}

function HandoverCard({ farmer, onAnother }: { farmer: RegisteredFarmer; onAnother: () => void }) {
  const { t } = useTranslation('coordinator');
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const signIn = farmer.user.phone ?? farmer.user.email ?? '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(farmer.temporary_password);
      setCopied(true);
      toast.success(t('register.copied', { defaultValue: 'Password copied' }));
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      toast.error(t('register.copyFailed', { defaultValue: 'Copy failed — read it out instead.' }));
    }
  };

  return (
    <Reveal>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card variant="dark" as="section" aria-labelledby="handover-title" className="relative overflow-hidden p-6 sm:p-8">
          <div className="relative flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="glass" icon={<ShieldCheck strokeWidth={1.25} aria-hidden="true" />}>
                {t('register.handoverBadge', { defaultValue: 'Shown once' })}
              </Badge>
            </div>
            <div className="flex flex-col gap-2">
              <p className="eyebrow eyebrow-rule text-gold-400">{t('register.handoverEyebrow', { defaultValue: 'Hand this to the farmer' })}</p>
              <h2 id="handover-title" className="font-display text-h2 font-bold text-ivory">
                {t('register.handoverTitle', { defaultValue: '{{name}} can now sign in', name: farmer.user.full_name })}
              </h2>
              <p className="max-w-measure text-sm font-normal leading-relaxed text-ivory/70">
                {t('register.handoverBody', {
                  defaultValue: 'Give them this temporary password privately. It will not be shown again — they will be asked to change it at first sign-in.',
                })}
              </p>
            </div>
            <dl className="grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-[13px] font-semibold text-ivory/55">{t('register.signInWith', { defaultValue: 'Sign in with' })}</dt>
                <dd className="font-display text-h3 font-bold tabular-nums text-ivory">{signIn}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[13px] font-semibold text-ivory/55">{t('register.tempPassword', { defaultValue: 'Temporary password' })}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code
                    aria-live="polite"
                    className="select-all rounded-sm border border-gold-400/40 px-3 py-1.5 font-mono text-lg tracking-[0.06em] text-gold-100"
                  >
                    {revealed ? farmer.temporary_password : '•'.repeat(Math.max(8, farmer.temporary_password.length))}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-ivory"
                    onClick={() => setRevealed((value) => !value)}
                    aria-pressed={!revealed}
                    leadingIcon={revealed ? <EyeOff strokeWidth={1.25} aria-hidden="true" /> : <Eye strokeWidth={1.25} aria-hidden="true" />}
                  >
                    {revealed ? t('register.hide', { defaultValue: 'Hide' }) : t('register.show', { defaultValue: 'Show' })}
                  </Button>
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="inverse" onClick={copy} leadingIcon={copied ? <Check strokeWidth={1.25} aria-hidden="true" /> : <Copy strokeWidth={1.25} aria-hidden="true" />}>
                {copied ? t('register.copiedShort', { defaultValue: 'Copied' }) : t('register.copy', { defaultValue: 'Copy password' })}
              </Button>
            </div>
          </div>
        </Card>

        <Card variant="flat" as="aside" className="flex flex-col gap-4 p-6 sm:p-8">
          <p className="eyebrow eyebrow-rule">{t('register.nextEyebrow', { defaultValue: 'Next' })}</p>
          <h2 className="font-display text-h3 font-bold text-ink">{t('register.nextTitle', { defaultValue: 'While they are with you' })}</h2>
          <p className="text-sm font-normal leading-relaxed text-ink-2">
            {t('register.nextBody', { defaultValue: 'List their harvest now so it can be pooled into the next lot.' })}
          </p>
          <div className="mt-auto flex flex-col gap-2.5">
            <LinkButton to={`/app/coordinator/harvests/new?farmer=${farmer.user.id}`} leadingIcon={<Mic aria-hidden="true" strokeWidth={1.25} />}>
              {t('register.listHarvest', { defaultValue: 'List their harvest' })}
            </LinkButton>
            <Button type="button" variant="secondary" onClick={onAnother} leadingIcon={<UserPlus aria-hidden="true" strokeWidth={1.25} />}>
              {t('register.another', { defaultValue: 'Register another farmer' })}
            </Button>
            <LinkButton to="/app/coordinator/farmers" variant="ghost" leadingIcon={<Users aria-hidden="true" strokeWidth={1.25} />}>
              {t('register.toRoster', { defaultValue: 'Back to farmers' })}
            </LinkButton>
          </div>
        </Card>
      </div>
    </Reveal>
  );
}
