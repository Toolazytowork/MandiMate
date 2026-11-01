import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { isLanguage, LANGUAGES, setLanguage } from '@/lib/i18n';
import type { Language } from '@/types/api';

export interface LanguageSwitcherProps {
  /** `dark` on forest surfaces (sidebar, editorial panels). */
  tone?: 'light' | 'dark';
  /** Show the "Language" caption with an icon above the control. */
  showLabel?: boolean;
  fullWidth?: boolean;
  /** Short label (EN · हि · తె · ಕ · اُ) on the trigger for tight spaces; the full name stays available to screen readers. */
  compact?: boolean;
  className?: string;
}

const SHORT_LABELS: Record<Language, string> = { en: 'EN', hi: 'हि', te: 'తె', kn: 'ಕ', ur: 'اُ' };

const TRIGGER_TONES = {
  light: 'border-line bg-paper text-ink hover:border-forest-600/40',
  dark: 'border-ivory/20 bg-transparent text-ivory hover:border-ivory/40',
} as const;

/**
 * Language menu. Each language is named in its own script (English · हिन्दी · తెలుగు · ಕನ್ನಡ · اردو)
 * so everyone can find theirs; a menu keeps five languages usable in the navbar and the sidebar.
 */
export function LanguageSwitcher({ tone = 'light', showLabel = false, fullWidth = false, compact = false, className }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation('common');
  const current: Language = isLanguage(i18n.language) ? i18n.language : 'en';
  const currentOption = LANGUAGES.find((language) => language.code === current) ?? LANGUAGES[0]!;
  const label = t('a11y.languageSwitcher', { defaultValue: 'Change language' });

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {showLabel ? (
        <p
          className={cn(
            'flex items-center gap-1.5 text-[13px] font-semibold',
            tone === 'dark' ? 'text-ivory/55' : 'text-muted',
          )}
        >
          <Languages aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
          {t('languages.label', { defaultValue: 'Language' })}
        </p>
      ) : null}
      <DropdownMenu
        label={label}
        align={fullWidth ? 'start' : 'end'}
        widthClassName="w-48"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={`${label}: ${currentOption.native}`}
            className={cn(
              'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-sm border px-3 text-[13px] font-semibold transition-colors duration-300',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-600',
              TRIGGER_TONES[tone],
              fullWidth && 'w-full justify-between',
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Languages aria-hidden="true" strokeWidth={1.25} className="size-4 opacity-70" />
              <span lang={current} title={currentOption.label}>
                {compact ? SHORT_LABELS[current] : currentOption.native}
              </span>
            </span>
            <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-3.5 opacity-60" />
          </button>
        )}
      >
        {LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.code}
            aria-current={language.code === current ? 'true' : undefined}
            onSelect={() => void setLanguage(language.code)}
            className={cn(language.code === current && 'font-semibold text-forest-700')}
            icon={<Check aria-hidden="true" className={cn('size-4', language.code === current ? '!text-forest-600' : 'invisible')} />}
            hint={<span lang="en">{language.label}</span>}
          >
            <span lang={language.code} dir={language.dir}>
              {language.native}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
