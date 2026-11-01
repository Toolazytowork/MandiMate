import { useTranslation } from 'react-i18next';
import { LocateFixed, MapPin, X } from 'lucide-react';

import { Button, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';

import { formatCoordinates, useGeolocation, type GeolocationStatus } from '../useGeolocation';

export interface CoordinatesControlProps {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  onChange: (coordinates: { latitude: number; longitude: number } | null) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * "Use my location": pins the farm or business with the browser's location (lat/lng only),
 * shows the pinned coordinates and lets the person remove them again.
 */
export function CoordinatesControl({ latitude, longitude, onChange, disabled = false, className }: CoordinatesControlProps) {
  const { t } = useTranslation('auth');
  const { status, locate, reset } = useGeolocation();
  const pinned = typeof latitude === 'number' && typeof longitude === 'number';

  const use = async () => {
    const position = await locate();
    if (position) onChange({ latitude: position.latitude, longitude: position.longitude });
  };

  const problem = problemMessage(status, t);

  return (
    <div className={cn('flex flex-col gap-3 rounded-card border border-line bg-paper p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MapPin
            aria-hidden="true"
            strokeWidth={1.25}
            className={cn('mt-0.5 size-[18px] shrink-0 transition-colors duration-300', pinned ? 'text-gold-700' : 'text-muted')}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">
              {pinned
                ? t('location.pinned', { defaultValue: 'Location pinned' })
                : t('location.title', { defaultValue: 'Pin your exact location' })}
            </p>
            <p aria-live="polite" className="font-mono text-[12px] tabular-nums text-muted">
              {pinned
                ? formatCoordinates(latitude, longitude)
                : t('location.optional', { defaultValue: 'Optional — helps estimate transport' })}
            </p>
          </div>
        </div>
        {pinned ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              reset();
              onChange(null);
            }}
            leadingIcon={<X aria-hidden="true" strokeWidth={1.25} />}
            className="text-muted"
          >
            {t('location.remove', { defaultValue: 'Remove' })}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || status === 'locating'}
            onClick={() => void use()}
            leadingIcon={
              status === 'locating' ? <Spinner size="xs" /> : <LocateFixed aria-hidden="true" strokeWidth={1.25} />
            }
          >
            {status === 'locating'
              ? t('location.locating', { defaultValue: 'Finding you…' })
              : t('location.useMine', { defaultValue: 'Use my location' })}
          </Button>
        )}
      </div>
      {problem && !pinned ? (
        <p role="alert" className="text-[13px] leading-5 text-danger-ink">
          {problem}
        </p>
      ) : null}
      <p className="text-[12px] leading-5 text-muted">
        {t('location.privacy', {
          defaultValue:
            'Used only to plan pickups and find neighbours to pool with. Your exact location is never shown to buyers.',
        })}
      </p>
    </div>
  );
}

function problemMessage(status: GeolocationStatus, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  switch (status) {
    case 'denied':
      return t('location.errors.denied', {
        defaultValue: 'Location access is blocked. Allow it in your browser settings, or just fill in your village and district.',
      });
    case 'timeout':
      return t('location.errors.timeout', { defaultValue: 'Finding your location took too long. Please try again.' });
    case 'unavailable':
      return t('location.errors.unavailable', {
        defaultValue: 'Your location could not be found right now. You can fill in your village and district instead.',
      });
    case 'unsupported':
      return t('location.errors.unsupported', {
        defaultValue: 'This browser cannot share a location. You can fill in your village and district instead.',
      });
    default:
      return null;
  }
}
