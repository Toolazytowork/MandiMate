import { useTranslation } from 'react-i18next';

/** First focusable element on every page: jumps keyboard users to `<main id="main">`. */
export function SkipLink() {
  const { t } = useTranslation('common');
  return (
    <a
      href="#main"
      className="sr-only rounded-sm bg-forest-900 px-5 py-3 text-[13px] font-semibold text-ivory shadow-luxe-lg focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100]"
    >
      {t('a11y.skipToContent', { defaultValue: 'Skip to main content' })}
    </a>
  );
}
