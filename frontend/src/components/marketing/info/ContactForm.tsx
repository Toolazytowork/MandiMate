import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, CircleCheck } from 'lucide-react';
import { z } from 'zod';
import { Button, Field, Input, Select, Textarea, toast } from '@/components/ui';
import { ApiError, publicApi } from '@/lib/api';
import type { ContactRequest } from '@/types/api';

export const CONTACT_ROLES = [
  { value: 'farmer', label: 'Farmer' },
  { value: 'fpo', label: 'FPO or cluster coordinator' },
  { value: 'buyer', label: 'Buyer or processor' },
  { value: 'transporter', label: 'Transporter' },
  { value: 'partner', label: 'Government, NGO or research partner' },
  { value: 'other', label: 'Something else' },
] as const;

/** Validation messages (English). They are translated where shown, via `contactForm.errors.<key>`. */
const ERRORS = {
  nameRequired: 'Please tell us your name.',
  nameTooLong: 'Keep the name under 120 characters.',
  emailRequired: 'We need an email address to reply.',
  emailTooLong: 'That email address is too long.',
  emailInvalid: 'Enter a valid email address, like name@example.com.',
  organizationTooLong: 'Keep this under 160 characters.',
  messageTooShort: 'A little more detail helps — at least 20 characters.',
  messageTooLong: 'Keep the message under 4,000 characters.',
} as const;

const ERROR_KEYS = new Map<string, string>(Object.entries(ERRORS).map(([key, message]) => [message, key]));

const schema = z.object({
  name: z.string().trim().min(2, ERRORS.nameRequired).max(120, ERRORS.nameTooLong),
  email: z
    .string()
    .trim()
    .min(1, ERRORS.emailRequired)
    .max(254, ERRORS.emailTooLong)
    .email(ERRORS.emailInvalid),
  organization: z.string().trim().max(160, ERRORS.organizationTooLong),
  role: z.string(),
  message: z
    .string()
    .trim()
    .min(20, ERRORS.messageTooShort)
    .max(4000, ERRORS.messageTooLong),
});

type ContactValues = z.infer<typeof schema>;
const FIELDS: readonly (keyof ContactValues)[] = ['name', 'email', 'organization', 'role', 'message'];

const EMPTY: ContactValues = { name: '', email: '', organization: '', role: '', message: '' };

export function ContactForm({ defaultRole = '' }: { defaultRole?: string }) {
  const { t } = useTranslation('marketingInfo');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    watch,
    formState: { errors },
  } = useForm<ContactValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...EMPTY, role: defaultRole },
  });

  const mutation = useMutation({
    mutationFn: (request: ContactRequest) => publicApi.contact(request),
  });

  const messageLength = watch('message')?.length ?? 0;

  /** Translate a known validation message; server-provided messages are shown as they arrive. */
  const errorText = (message: string | undefined) => {
    if (!message) return undefined;
    const key = ERROR_KEYS.get(message);
    return key ? t(`contactForm.errors.${key}`, { defaultValue: message }) : message;
  };

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    const request: ContactRequest = {
      name: values.name,
      email: values.email,
      organization: values.organization || null,
      role: values.role || null,
      message: values.message,
    };
    mutation.mutate(request, {
      onSuccess: () => {
        setSentTo(values.email);
        reset({ ...EMPTY, role: values.role });
        toast.success(t('contactForm.toast.sent', { defaultValue: 'Message sent' }), {
          description: t('contactForm.toast.sentDescription', { defaultValue: 'We usually reply within two working days.' }),
        });
      },
      onError: (error) => {
        let placed = false;
        if (error instanceof ApiError) {
          for (const [key, message] of Object.entries(error.fieldErrors)) {
            const field = FIELDS.find((name) => key === name || key.endsWith(`.${name}`));
            if (field) {
              setError(field, { type: 'server', message }, { shouldFocus: !placed });
              placed = true;
            }
          }
        }
        const text =
          error instanceof ApiError && !placed
            ? error.message
            : placed
              ? t('contactForm.errors.checkFields', { defaultValue: 'Please check the highlighted fields.' })
              : t('contactForm.errors.network', {
                  defaultValue: 'We could not send your message. Check your connection and try again.',
                });
        setFormError(text);
        toast.error(t('contactForm.toast.notSent', { defaultValue: 'Message not sent' }), { description: text });
        if (!placed) setFocus('name');
      },
    });
  });

  if (sentTo) {
    return (
      <div role="status" className="flex flex-col items-start gap-5 py-6">
        <span className="text-forest-600">
          <CircleCheck aria-hidden="true" strokeWidth={1.25} className="size-7" />
        </span>
        <h3 className="font-display font-bold text-[1.75rem] leading-tight tracking-[-0.015em] text-ink">
          {t('contactForm.success.title', { defaultValue: 'Thank you — it has reached us.' })}
        </h3>
        <p className="max-w-md text-[15px] font-normal leading-relaxed text-ink-2">
          <Trans
            t={t}
            i18nKey="contactForm.success.body"
            defaults="A member of the MandiMate team will reply to <strong>{{email}}</strong>, usually within two working days. If you are a farmer in the pilot cluster, your coordinator may call you first."
            values={{ email: sentTo }}
            components={{ strong: <strong className="font-medium text-ink" /> }}
          />
        </p>
        <Button variant="secondary" onClick={() => setSentTo(null)}>
          {t('contactForm.success.sendAnother', { defaultValue: 'Send another message' })}
        </Button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} aria-describedby={formError ? 'contact-form-error' : undefined} className="flex flex-col gap-6">
      {formError ? (
        <p
          id="contact-form-error"
          role="alert"
          className="flex items-start gap-2.5 rounded-sm border border-danger/40 px-4 py-3 text-sm leading-relaxed text-danger-ink"
        >
          <CircleAlert aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0" />
          <span>{formError}</span>
        </p>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label={t('contactForm.name.label', { defaultValue: 'Your name' })} required error={errorText(errors.name?.message)}>
          <Input autoComplete="name" placeholder={t('contactForm.name.placeholder', { defaultValue: 'Lakshmi Reddy' })} {...register('name')} />
        </Field>
        <Field label={t('contactForm.email.label', { defaultValue: 'Email' })} required error={errorText(errors.email?.message)}>
          <Input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" {...register('email')} />
        </Field>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label={t('contactForm.organization.label', { defaultValue: 'Organisation' })}
          optional
          error={errorText(errors.organization?.message)}
        >
          <Input
            autoComplete="organization"
            placeholder={t('contactForm.organization.placeholder', { defaultValue: 'FPO, company or village' })}
            {...register('organization')}
          />
        </Field>
        <Field label={t('contactForm.role.label', { defaultValue: 'I am a' })} optional error={errorText(errors.role?.message)}>
          <Select placeholder={t('contactForm.role.placeholder', { defaultValue: 'Choose one' })} {...register('role')}>
            {CONTACT_ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {t(`contactForm.roles.${role.value}`, { defaultValue: role.label })}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label={t('contactForm.message.label', { defaultValue: 'How can we help?' })}
        required
        error={errorText(errors.message?.message)}
        hint={t('contactForm.message.hint', { defaultValue: 'Tell us your crop, location and rough volumes if you have them.' })}
        labelAside={
          <span aria-hidden="true" className="text-xs tabular-nums text-muted">
            {messageLength}/4000
          </span>
        }
      >
        <Textarea rows={6} {...register('message')} />
      </Field>

      <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-sm text-[13px] font-normal leading-relaxed text-ink-2">
          <Trans
            t={t}
            i18nKey="contactForm.privacy"
            defaults="We use these details only to reply to you. See our <policy>privacy policy</policy>."
            components={{ policy: <Link to="/privacy" className="link-luxe text-ink" /> }}
          />
        </p>
        <Button
          type="submit"
          size="lg"
         
          loading={mutation.isPending}
          trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.25} className="size-4" />}
        >
          {t('contactForm.submit', { defaultValue: 'Send message' })}
        </Button>
      </div>
    </form>
  );
}
