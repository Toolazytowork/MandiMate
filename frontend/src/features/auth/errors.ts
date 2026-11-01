import type { TFunction } from 'i18next';

import { ApiError } from '@/lib/api';

/** A friendly, translated sentence for a failed sign-in or sign-up. */
export function authErrorMessage(error: unknown, t: TFunction, context: 'login' | 'signup'): string {
  if (error instanceof ApiError) {
    if (error.status === 401 && context === 'login') {
      return t('errors.invalidCredentials', {
        defaultValue: 'That email or phone and password don’t match. Check both and try again.',
      });
    }
    if (error.status === 429) {
      return t('errors.rateLimited', {
        defaultValue: 'Too many attempts. For your safety, please wait a minute before trying again.',
      });
    }
    if (error.status === 409) {
      return t('errors.exists', {
        defaultValue: 'An account already uses this email or phone. Try signing in instead.',
      });
    }
    if (error.status === 0 || error.status >= 500) {
      return t('errors.server', {
        defaultValue: 'We couldn’t reach MandiMate just now. Check your connection and try again.',
      });
    }
    if (error.detail) return error.detail;
  }
  return t('errors.generic', { defaultValue: 'Something went wrong. Please try again.' });
}
