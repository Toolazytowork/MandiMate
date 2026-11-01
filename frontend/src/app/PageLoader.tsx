import { useTranslation } from 'react-i18next';

import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Suspense fallback while a lazily loaded page chunk arrives. */
export function PageLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  const { t } = useTranslation('common');
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 text-muted',
        fullScreen ? 'min-h-dvh bg-ivory' : 'min-h-[60vh]',
      )}
    >
      <Spinner size="lg" label={t('states.loading')} className="text-forest-900" />
      <p className="text-micro tracking-eyebrow text-gold-600" aria-hidden="true">
        {t('brand.name')}
      </p>
    </div>
  );
}
