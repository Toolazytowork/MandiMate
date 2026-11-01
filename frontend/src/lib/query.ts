import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/lib/api/client';

const MAX_RETRIES = 2;

/** Client errors (4xx) are deterministic — retrying them only delays the error state. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

/** A fresh client per browser session and per server render (never share one across SSR requests). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
