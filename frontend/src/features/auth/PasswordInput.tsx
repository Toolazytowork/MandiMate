import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff } from 'lucide-react';

import { Input, type InputProps } from '@/components/ui';
import { cn } from '@/lib/cn';

import { passwordRules, passwordScore } from './password';

/** Password input with an inline show / hide toggle. Spreads react-hook-form `register()` props. */
export function PasswordInput(props: Omit<InputProps, 'type' | 'trailing'>) {
  const { t } = useTranslation('auth');
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={
            visible
              ? t('password.hide', { defaultValue: 'Hide password' })
              : t('password.show', { defaultValue: 'Show password' })
          }
          className="-me-1 grid size-9 place-items-center rounded-full text-muted transition-colors hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {visible ? (
            <EyeOff aria-hidden="true" strokeWidth={1.25} className="size-[18px]" />
          ) : (
            <Eye aria-hidden="true" strokeWidth={1.25} className="size-[18px]" />
          )}
        </button>
      }
    />
  );
}

const SEGMENT_TONE = ['bg-line', 'bg-danger', 'bg-gold-500', 'bg-forest-600', 'bg-forest-800'] as const;

/** Four hairline segments plus the two policy rules, ticked as they are met. */
export function PasswordStrength({ password, id }: { password: string; id?: string }) {
  const { t } = useTranslation('auth');
  const score = passwordScore(password);
  const rules = passwordRules(password);
  const labels = [
    t('password.strength.empty', { defaultValue: 'Choose a password' }),
    t('password.strength.weak', { defaultValue: 'Too weak' }),
    t('password.strength.fair', { defaultValue: 'Fair' }),
    t('password.strength.good', { defaultValue: 'Good' }),
    t('password.strength.strong', { defaultValue: 'Strong' }),
  ];

  const hints = [
    { met: rules.length, label: t('password.rule.length', { defaultValue: 'At least 8 characters' }) },
    { met: rules.letterAndDigit, label: t('password.rule.mix', { defaultValue: 'A letter and a number' }) },
  ];

  return (
    <div id={id} className="mt-3">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((segment) => (
            <span
              key={segment}
              className={cn(
                'h-px transition-colors duration-500 ease-luxe',
                score >= segment ? SEGMENT_TONE[score] : 'bg-line',
              )}
            />
          ))}
        </div>
        <p className="min-w-[5.5rem] text-end text-[13px] font-semibold text-muted" aria-live="polite">
          <span className="sr-only">{t('password.strength.label', { defaultValue: 'Password strength:' })} </span>
          {labels[score]}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {hints.map((hint) => (
          <li
            key={hint.label}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs transition-colors',
              hint.met ? 'text-success-ink' : 'text-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-3.5 place-items-center rounded-sm border transition-colors',
                hint.met ? 'border-forest-600 text-forest-600' : 'border-line',
              )}
            >
              {hint.met ? <Check strokeWidth={2} className="size-2.5" /> : null}
            </span>
            {hint.label}
            <span className="sr-only">
              {hint.met
                ? t('password.rule.met', { defaultValue: '(done)' })
                : t('password.rule.unmet', { defaultValue: '(not yet)' })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
