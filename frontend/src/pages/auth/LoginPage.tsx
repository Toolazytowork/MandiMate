import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { ArrowRight, AtSign } from 'lucide-react';
import { z } from 'zod';

import { PageHeader } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { Button, Divider, Field, Input } from '@/components/ui';
import { DemoAccounts, FormAlert, PasswordInput, authErrorMessage, type DemoAccount } from '@/features/auth';
import { DEMO_PASSWORD } from '@/features/auth/constants';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { routeMeta, Seo } from '@/lib/seo';

const meta = routeMeta('/login');

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const { login } = useAuth();
  const { search } = useLocation();
  const submitRef = useRef<HTMLButtonElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | undefined>();

  const schema = useMemo(
    () =>
      z.object({
        identifier: z
          .string()
          .trim()
          .min(1, t('login.identifier.required', { defaultValue: 'Enter your email or phone number.' })),
        password: z.string().min(1, t('login.password.required', { defaultValue: 'Enter your password.' })),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { identifier: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login({ identifier: values.identifier.trim(), password: values.password });
      // GuestOnly redirects to the role home (or ?next=) as soon as the session lands.
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'identifier' || field === 'password') setError(field, { message });
        }
      }
      setFormError(authErrorMessage(error, t, 'login'));
    }
  });

  const pickDemo = (account: DemoAccount) => {
    setValue('identifier', account.email, { shouldDirty: true });
    setValue('password', DEMO_PASSWORD, { shouldDirty: true });
    clearErrors();
    setFormError(null);
    setPicked(account.email);
    requestAnimationFrame(() => submitRef.current?.focus());
  };

  return (
    <>
      <Seo {...meta} noindex />
      <Reveal>
        <PageHeader
          eyebrow={t('login.eyebrow', { defaultValue: 'Welcome back' })}
          title={t('login.title', { defaultValue: 'Sign in to MandiMate' })}
          description={t('login.description', {
            defaultValue: 'Your harvests, offers, lots and payments — exactly where you left them.',
          })}
        />
      </Reveal>

      <Reveal delay={0.08}>
        <form noValidate onSubmit={onSubmit} className="mt-10 flex flex-col gap-6" aria-busy={isSubmitting}>
          {formError ? <FormAlert>{formError}</FormAlert> : null}

          <Field
            label={t('login.identifier.label', { defaultValue: 'Email or phone' })}
            hint={t('login.identifier.hint', { defaultValue: 'Phone numbers work with or without +91.' })}
            error={errors.identifier?.message}
            required
          >
            <Input
              {...register('identifier', { onChange: () => setPicked(undefined) })}
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t('login.identifier.placeholder', { defaultValue: 'you@example.com or 98xxxxxx10' })}
              leading={<AtSign aria-hidden="true" strokeWidth={1.25} className="size-4" />}
            />
          </Field>

          <Field
            label={t('login.password.label', { defaultValue: 'Password' })}
            error={errors.password?.message}
            required
            labelAside={
              <Link to="/forgot-password" className="text-[13px] font-semibold text-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
                {t('login.forgot', { defaultValue: 'Forgot password?' })}
              </Link>
            }
          >
            <PasswordInput {...register('password')} autoComplete="current-password" />
          </Field>

          <Button
            ref={submitRef}
            type="submit"
            size="lg"
            fullWidth
            loading={isSubmitting}
            trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.25} className="size-4" />}
            className="mt-2"
          >
            {isSubmitting
              ? t('login.submitting', { defaultValue: 'Signing in…' })
              : t('login.submit', { defaultValue: 'Sign in' })}
          </Button>

          <p className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-6 text-sm font-normal text-ink-2">
            {t('login.newHere', { defaultValue: 'New to MandiMate?' })}
            <Link
              to={{ pathname: '/signup', search }}
              className="inline-flex items-center gap-2 border-b border-ink/40 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-ink"
            >
              {t('login.createAccount', { defaultValue: 'Create an account' })}
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        </form>
      </Reveal>

      <Reveal delay={0.16}>
        <Divider className="my-10" label={t('login.or', { defaultValue: 'or explore' })} />
        <DemoAccounts onPick={pickDemo} selected={picked} />
      </Reveal>
    </>
  );
}
