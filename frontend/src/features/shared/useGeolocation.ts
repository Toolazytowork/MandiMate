import { useCallback, useState } from 'react';

export type GeolocationStatus = 'idle' | 'locating' | 'success' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres. */
  accuracy: number;
}

/** Six decimals ≈ 11 cm — far more than the pricing engine needs, and what the API stores. */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * One-shot browser geolocation for "Use my location". Never runs during render, so it is SSR-safe;
 * resolves `null` (with a status explaining why) when the position is unavailable.
 */
export function useGeolocation() {
  const [status, setStatus] = useState<GeolocationStatus>('idle');

  const locate = useCallback(
    () =>
      new Promise<Coordinates | null>((resolve) => {
        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
          setStatus('unsupported');
          resolve(null);
          return;
        }
        setStatus('locating');
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setStatus('success');
            resolve({
              latitude: round6(position.coords.latitude),
              longitude: round6(position.coords.longitude),
              accuracy: Math.round(position.coords.accuracy),
            });
          },
          (error) => {
            setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'unavailable');
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
        );
      }),
    [],
  );

  const reset = useCallback(() => setStatus('idle'), []);

  return { status, locate, reset };
}

/** "13.5503° N, 78.5029° E" */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lng}`;
}
