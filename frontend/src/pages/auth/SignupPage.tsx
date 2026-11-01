import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, LocateFixed, MapPin, X } from 'lucide-react';
import { z } from 'zod';

import { PageHeader } from '@/components/domain';
import { Reveal } from '@/components/motion';
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Select,
  toast,
} from '@/components/ui';
import {
  FormAlert,
  INDIAN_STATES,
  PasswordInput,
  PasswordStrength,
  RoleIcon,
  SIGNUP_ROLES,
  authErrorMessage,
  isSignupRole,
  meetsPasswordPolicy,
  useRoleLabel,
} from '@/features/auth';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { isLanguage, LANGUAGES } from '@/lib/i18n';
import { routeMeta, Seo } from '@/lib/seo';
import type { Language, SignupRequest, SignupRole } from '@/types/api';

const meta = routeMeta('/signup');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{10,13}$/;

const baseSchema = z.object({
  role: z.string(),
  full_name: z.string(),
  email: z.string(),
  phone: z.string(),
  password: z.string(),
  organization_name: z.string(),
  preferred_language: z.enum(['en', 'hi', 'te', 'kn', 'ur']),
  village: z.string(),
  district: z.string(),
  state: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
type Values = z.infer<typeof baseSchema>;

const STEP_FIELDS: readonly (readonly FieldPath<Values>[])[] = [
  ['role'],
  ['full_name', 'email', 'phone', 'password', 'organization_name', 'preferred_language'],
  ['village', 'district', 'state'],
];

function stepOf(field: string): number {
  const index = STEP_FIELDS.findIndex((fields) => (fields as readonly string[]).includes(field));
  return index === -1 ? 1 : index;
}

export default function SignupPage() {
  const { t, i18n } = useTranslation('auth');
  const { signup } = useAuth();
  const { search } = useLocation();
  const [params] = useSearchParams();
  const reduceMotion = useReducedMotion();
  const roleLabel = useRoleLabel();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevStep = useRef(0);

  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [geo, setGeo] = useState<'idle' | 'locating' | 'error'>('idle');

  const presetRole = params.get('role');
  const uiLanguage: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  const schema = useMemo(
    () =>
      baseSchema.superRefine((v, ctx) => {
        const issue = (path: FieldPath<Values>, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
        if (!isSignupRole(v.role)) issue('role', t('signup.errors.role', { defaultValue: 'Choose how you’ll use MandiMate.' }));
        if (v.full_name.trim().length < 2) issue('full_name', t('signup.errors.name', { defaultValue: 'Enter your full name.' }));
        const email = v.email.trim();
        const phone = v.phone.replace(/[\s-]/g, '');
        if (!email && !phone) {
          issue('email', t('signup.errors.contact', { defaultValue: 'Add an email or a phone number — either works.' }));
        }
        if (email && !EMAIL_RE.test(email)) issue('email', t('signup.errors.email', { defaultValue: 'Enter a valid email address.' }));
        if (phone && !PHONE_RE.test(phone)) {
          issue('phone', t('signup.errors.phone', { defaultValue: 'Enter a 10-digit mobile number, with or without +91.' }));
        }
        if (!meetsPasswordPolicy(v.password)) {
          issue('password', t('signup.errors.password', { defaultValue: 'Use at least 8 characters with a letter and a number.' }));
        }
        if (v.role !== 'farmer' && isSignupRole(v.role) && v.organization_name.trim().length < 2) {
          issue('organization_name', t('signup.errors.organisation', { defaultValue: 'Enter your organisation’s name.' }));
        }
        if (v.role === 'farmer' && !v.village.trim()) issue('village', t('signup.errors.village', { defaultValue: 'Enter your village.' }));
        if (!v.district.trim()) issue('district', t('signup.errors.district', { defaultValue: 'Enter your district.' }));
        if (!v.state) issue('state', t('signup.errors.state', { defaultValue: 'Choose your state.' }));
      }),
    [t],
  );

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: isSignupRole(presetRole) ? presetRole : '',
      full_name: '',
      email: '',
      phone: '',
      password: '',
      organization_name: '',
      preferred_language: uiLanguage,
      village: '',
      district: '',
      state: '',
      latitude: null,
      longitude: null,
    },
  });

  const [role, password, language, latitude, longitude] = useWatch({
    control,
    name: ['role', 'password', 'preferred_language', 'latitude', 'longitude'],
  });
  const signupRole: SignupRole | null = isSignupRole(role) ? role : null;

  // Move focus to the new step's heading so keyboard and screen-reader users land in context.
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const steps = [
    t('signup.steps.role', { defaultValue: 'Your role' }),
    t('signup.steps.details', { defaultValue: 'Your details' }),
    t('signup.steps.location', { defaultValue: 'Your location' }),
  ];

  const next = async () => {
    setFormError(null);
    if (await trigger(STEP_FIELDS[step] as FieldPath<Values>[], { shouldFocus: true })) setStep((s) => Math.min(s + 1, 2));
  };
  const back = () => {
    setFormError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      setGeo('error');
      return;
    }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue('latitude', Number(position.coords.latitude.toFixed(6)), { shouldDirty: true });
        setValue('longitude', Number(position.coords.longitude.toFixed(6)), { shouldDirty: true });
        setGeo('idle');
        toast.success(t('signup.location.geoSaved', { defaultValue: 'Location saved. We’ll use it to plan pickups.' }));
      },
      () => setGeo('error'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  };

  const clearLocation = () => {
    setValue('latitude', null);
    setValue('longitude', null);
  };

  const onSubmit = handleSubmit(
    async (v) => {
      setFormError(null);
      const chosenRole = v.role as SignupRole;
      const req: SignupRequest = {
        full_name: v.full_name.trim(),
        email: v.email.trim() || null,
        phone: v.phone.replace(/[\s-]/g, '') || null,
        password: v.password,
        role: chosenRole,
        preferred_language: v.preferred_language,
        organization_name: chosenRole === 'farmer' ? null : v.organization_name.trim() || null,
        village: v.village.trim() || null,
        district: v.district.trim() || null,
        state: v.state || null,
        latitude: v.latitude,
        longitude: v.longitude,
      };
      try {
        const user = await signup(req);
        toast.success(
          t('signup.welcome', { defaultValue: 'Welcome to MandiMate, {{name}}.', name: user.full_name.split(' ')[0] }),
        );
        // GuestOnly redirects to the new account's home automatically.
      } catch (error) {
        let firstStep: number | null = null;
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) {
            if (field in baseSchema.shape) {
              setError(field as FieldPath<Values>, { message });
              const s = stepOf(field);
              firstStep = firstStep === null ? s : Math.min(firstStep, s);
            }
          }
          if (error.status === 409 && firstStep === null) firstStep = 1;
        }
        if (firstStep !== null) setStep(firstStep);
        setFormError(authErrorMessage(error, t, 'signup'));
      }
    },
    (fieldErrors) => {
      const first = Object.keys(fieldErrors)[0];
      if (first) setStep(stepOf(first));
    },
  );

  const orgLabel =
    signupRole === 'coordinator'
      ? t('signup.organisation.fpo', { defaultValue: 'FPO name' })
      : signupRole === 'transporter'
        ? t('signup.organisation.transport', { defaultValue: 'Company name' })
        : t('signup.organisation.business', { defaultValue: 'Business name' });

  const roleCopy: Record<SignupRole, { description: string; meta?: string }> = {
    farmer: {
      description: t('roles.farmer.description', {
        defaultValue: 'Pool your harvest with neighbours and see what you truly take home before you agree.',
      }),
      meta: t('roles.farmer.meta', { defaultValue: 'Always free' }),
    },
    buyer: {
      description: t('roles.buyer.description', {
        defaultValue: 'Source graded, buyer-ready lots with a clear landed cost and traceable farmers.',
      }),
    },
    transporter: {
      description: t('roles.transporter.description', {
        defaultValue: 'Quote on pooled pickups with planned routes and fuller loads.',
      }),
    },
    coordinator: {
      description: t('roles.coordinator.description', {
        defaultValue: 'Run your FPO’s pooling, consent, pickups, quality and settlements in one place.',
      }),
    },
  };

  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 } };

  return (
    <>
      <Seo {...meta} noindex />
      <Reveal>
        <PageHeader
          eyebrow={t('signup.eyebrow', { defaultValue: 'Join the pilot' })}
          title={t('signup.title', { defaultValue: 'Create your account' })}
          description={t('signup.description', {
            defaultValue: 'Three short steps. Free for farmers, in English, Hindi, Telugu, Kannada and Urdu.',
          })}
        />
      </Reveal>

      {/* Step indicator */}
      <nav aria-label={t('signup.progress', { defaultValue: 'Sign-up progress' })} className="mt-8">
        <ol className="grid grid-cols-3 gap-2">
          {steps.map((label, index) => {
            const done = index < step;
            const current = index === step;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => setStep(index)}
                  aria-current={current ? 'step' : undefined}
                  className="group flex w-full flex-col gap-2 text-start disabled:cursor-default"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-px w-full transition-colors duration-500 ease-luxe',
                      done ? 'bg-ink' : current ? 'bg-gold-700' : 'bg-line',
                    )}
                  />
                  <span
                    className={cn(
                      'flex items-baseline gap-2 text-[13px] font-semibold',
                      current ? 'text-ink' : done ? 'text-ink-2 group-hover:text-ink' : 'text-muted',
                    )}
                  >
                    {done ? (
                      <Check aria-hidden="true" strokeWidth={1.25} className="size-3 self-center" />
                    ) : (
                      <span className="font-display text-sm not-italic normal-case tracking-normal text-gold-700 tabular-nums">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    )}
                    <span className="truncate">{label}</span>
                    {done ? <span className="sr-only">{t('signup.stepDone', { defaultValue: '(completed)' })}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form noValidate onSubmit={onSubmit} className="mt-8" aria-busy={isSubmitting}>
        {formError ? (
          <div className="mb-5">
            <FormAlert>{formError}</FormAlert>
          </div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} {...slide} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
            <h2 ref={headingRef} tabIndex={-1} className="font-display text-h3 font-bold text-ink outline-none">
              {step === 0
                ? t('signup.role.heading', { defaultValue: 'How will you use MandiMate?' })
                : step === 1
                  ? t('signup.details.heading', { defaultValue: 'Tell us about you' })
                  : t('signup.location.heading', { defaultValue: 'Where do you work from?' })}
            </h2>

            {step > 0 && signupRole ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-[13px] font-semibold text-ink">
                  <RoleIcon role={signupRole} className="size-3.5 text-muted" />
                  {roleLabel(signupRole)}
                </span>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="text-[13px] font-semibold text-muted underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink"
                >
                  {t('signup.changeRole', { defaultValue: 'Change' })}
                </button>
              </p>
            ) : null}

            {step === 0 ? (
              <div className="mt-6">
                <fieldset
                  aria-required="true"
                  aria-invalid={errors.role ? true : undefined}
                  aria-describedby={errors.role ? 'signup-role-error' : undefined}
                  className="min-w-0"
                >
                  <legend className="sr-only">{t('signup.role.label', { defaultValue: 'I am a…' })}</legend>
                  <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2">
                    {SIGNUP_ROLES.map((r, index) => {
                      const checked = role === r;
                      return (
                        <label
                          key={r}
                          className={cn(
                            'group/role relative flex min-h-44 cursor-pointer flex-col gap-4 p-6 transition-colors duration-300 ease-luxe',
                            'has-[:focus-visible]:[outline:1px_solid_var(--color-ink)] has-[:focus-visible]:[outline-offset:-4px]',
                            checked ? 'bg-forest-600 text-white' : 'bg-paper text-ink hover:bg-parchment',
                          )}
                        >
                          <input
                            type="radio"
                            name="role"
                            value={r}
                            checked={checked}
                            onChange={() => setValue('role', r, { shouldValidate: true, shouldDirty: true })}
                            className="sr-only"
                          />
                          <span className="flex items-start justify-between">
                            <RoleIcon role={r} className={cn('size-6', checked ? 'text-gold-400' : 'text-ink-2')} />
                            <span
                              aria-hidden="true"
                              className={cn('font-display text-lg not-italic leading-none tabular-nums', checked ? 'text-gold-400' : 'text-gold-700')}
                            >
                              {String(index + 1).padStart(2, '0')}
                            </span>
                          </span>
                          <span className="mt-auto flex flex-col gap-1.5">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="font-display text-2xl font-bold leading-tight">{roleLabel(r)}</span>
                              {roleCopy[r].meta ? (
                                <span
                                  className={cn(
                                    'shrink-0 text-[13px] font-semibold',
                                    checked ? 'text-ivory/70' : 'text-muted',
                                  )}
                                >
                                  {roleCopy[r].meta}
                                </span>
                              ) : null}
                            </span>
                            <span className={cn('text-[13px] font-normal leading-relaxed', checked ? 'text-ivory/75' : 'text-ink-2')}>
                              {roleCopy[r].description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {errors.role ? (
                    <p id="signup-role-error" className="mt-2 text-[13px] text-danger-ink">
                      {errors.role.message}
                    </p>
                  ) : null}
                </fieldset>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="mt-6 flex flex-col gap-5">
                <Field label={t('signup.name.label', { defaultValue: 'Full name' })} error={errors.full_name?.message} required>
                  <Input
                    {...register('full_name')}
                    autoComplete="name"
                    placeholder={t('signup.name.placeholder', { defaultValue: 'As people in your village know you' })}
                  />
                </Field>

                {signupRole && signupRole !== 'farmer' ? (
                  <Field label={orgLabel} error={errors.organization_name?.message} required>
                    <Input {...register('organization_name')} autoComplete="organization" />
                  </Field>
                ) : null}

                <fieldset className="flex flex-col gap-4">
                  <legend className="mb-1 text-[13px] font-normal text-ink-2">
                    {t('signup.contact.legend', { defaultValue: 'Add an email, a phone number, or both. You’ll sign in with either.' })}
                  </legend>
                  <Field label={t('signup.email.label', { defaultValue: 'Email' })} error={errors.email?.message} optional>
                    <Input
                      {...register('email')}
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="you@example.com"
                    />
                  </Field>
                  <Field label={t('signup.phone.label', { defaultValue: 'Mobile number' })} error={errors.phone?.message} optional>
                    <Input
                      {...register('phone')}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="98765 43210"
                      leading={<span className="text-sm text-muted">+91</span>}
                    />
                  </Field>
                </fieldset>

                <Field label={t('signup.password.label', { defaultValue: 'Password' })} error={errors.password?.message} required>
                  <PasswordInput {...register('password')} autoComplete="new-password" aria-describedby="password-strength" />
                </Field>
                <div className="-mt-3">
                  <PasswordStrength password={password} id="password-strength" />
                </div>

                <div className="flex flex-col gap-2">
                  <p aria-hidden="true" className="text-[13px] font-semibold text-ink">
                    {t('signup.language.label', { defaultValue: 'Preferred language' })}
                  </p>
                  <SegmentedControl<Language>
                    label={t('signup.language.label', { defaultValue: 'Preferred language' })}
                    options={LANGUAGES.map((l) => ({ value: l.code, label: <span lang={l.code}>{l.native}</span> }))}
                    value={language}
                    onValueChange={(value) => setValue('preferred_language', value, { shouldDirty: true })}
                    fullWidth
                  />
                  <p className="text-xs text-muted">
                    {t('signup.language.hint', { defaultValue: 'Offers, alerts and receipts will reach you in this language.' })}
                  </p>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-6 flex flex-col gap-5">
                <p className="text-[15px] font-normal leading-relaxed text-ink-2">
                  {t('signup.location.why', {
                    defaultValue: 'We group nearby harvests into one shared pickup, so your location keeps transport costs low.',
                  })}
                </p>
                <Field
                  label={t('signup.village.label', { defaultValue: 'Village or town' })}
                  error={errors.village?.message}
                  required={signupRole === 'farmer'}
                  optional={signupRole !== 'farmer'}
                >
                  <Input {...register('village')} autoComplete="address-level3" />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label={t('signup.district.label', { defaultValue: 'District' })} error={errors.district?.message} required>
                    <Input {...register('district')} autoComplete="address-level2" />
                  </Field>
                  <Field label={t('signup.state.label', { defaultValue: 'State' })} error={errors.state?.message} required>
                    <Select {...register('state')} autoComplete="address-level1" placeholder={t('signup.state.placeholder', { defaultValue: 'Choose…' })}>
                      {INDIAN_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="border-y border-line py-5">
                  {latitude !== null && longitude !== null ? (
                    <div className="flex items-center gap-3">
                      <MapPin aria-hidden="true" strokeWidth={1.25} className="size-[18px] shrink-0 text-gold-700" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-ink">
                          {t('signup.location.pinned', { defaultValue: 'Farm location pinned' })}
                        </span>
                        <span className="block font-mono text-xs text-muted tabular-nums">
                          {latitude.toFixed(4)}, {longitude.toFixed(4)}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearLocation}
                        leadingIcon={<X aria-hidden="true" strokeWidth={1.25} />}
                      >
                        {t('signup.location.clear', { defaultValue: 'Remove' })}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <p className="flex-1 text-xs leading-relaxed text-muted">
                        {t('signup.location.optional', {
                          defaultValue: 'Optional: share your current location for more accurate pickup routes. You can change it later.',
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={locateMe}
                        loading={geo === 'locating'}
                        leadingIcon={<LocateFixed aria-hidden="true" strokeWidth={1.25} />}
                      >
                        {t('signup.location.use', { defaultValue: 'Use my location' })}
                      </Button>
                    </div>
                  )}
                  {geo === 'error' ? (
                    <p role="status" className="mt-3 text-xs text-warning-ink">
                      {t('signup.location.geoError', {
                        defaultValue: 'Location could not be read. Allow location access, or continue — the district is enough.',
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center gap-3">
          {step > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={back}
              leadingIcon={<ArrowLeft aria-hidden="true" strokeWidth={1.25} className="size-4" />}
            >
              {t('signup.back', { defaultValue: 'Back' })}
            </Button>
          ) : null}
          {step < 2 ? (
            <Button
              type="button"
              size="lg"
              className="flex-1"
              onClick={() => void next()}
              trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.25} className="size-4" />}
            >
              {t('signup.continue', { defaultValue: 'Continue' })}
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="flex-1"
              loading={isSubmitting}
              trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.25} className="size-4" />}
            >
              {isSubmitting
                ? t('signup.submitting', { defaultValue: 'Creating your account…' })
                : t('signup.submit', { defaultValue: 'Create account' })}
            </Button>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          {t('signup.legalStart', { defaultValue: 'By creating an account you agree to the' })}{' '}
          <Link to="/terms" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            {t('signup.terms', { defaultValue: 'Terms' })}
          </Link>{' '}
          {t('signup.and', { defaultValue: 'and' })}{' '}
          <Link to="/privacy" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            {t('signup.privacy', { defaultValue: 'Privacy policy' })}
          </Link>
          .
        </p>
      </form>

      <p className="mt-10 flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-6 text-sm font-normal text-ink-2">
        {t('signup.haveAccount', { defaultValue: 'Already on MandiMate?' })}
        <Link
          to={{ pathname: '/login', search }}
          className="inline-flex items-center gap-2 border-b border-ink/40 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-ink"
        >
          {t('signup.signIn', { defaultValue: 'Sign in' })}
          <span aria-hidden="true">→</span>
        </Link>
      </p>
    </>
  );
}
