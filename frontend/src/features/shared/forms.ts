import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { isApiError } from '@/lib/api';

import type { Translate } from './messages';

export interface ApplyFieldErrorsOptions<T extends FieldValues> {
  /** Form fields that may receive server messages (API path → same-named field). */
  fields: readonly Path<T>[];
  /** API paths that map to a differently named field. */
  aliases?: Partial<Record<string, Path<T>>>;
  /** Domain error `code` → field, for 409s such as `email_taken`. */
  codes?: Partial<Record<string, Path<T>>>;
}

/**
 * Copies an API error's field messages (422 `fieldErrors`, or a known 409 `code`) onto
 * react-hook-form fields. Returns the fields that received a message, in order.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  { fields, aliases = {}, codes = {} }: ApplyFieldErrorsOptions<T>,
): Path<T>[] {
  if (!isApiError(error)) return [];
  const applied: Path<T>[] = [];

  for (const [path, message] of Object.entries(error.fieldErrors)) {
    const target = aliases[path] ?? (fields as readonly string[]).find((field) => field === path);
    if (!target) continue;
    setError(target as Path<T>, { type: 'server', message });
    applied.push(target as Path<T>);
  }

  const codeField = error.code ? codes[error.code] : undefined;
  if (codeField && !applied.includes(codeField)) {
    setError(codeField, { type: 'server', message: error.detail });
    applied.push(codeField);
  }

  return applied;
}

/** A human message for a failed request, preferring MandiMate's friendly translated copy. */
export function apiErrorMessage(error: unknown, t: Translate): string {
  if (isApiError(error)) {
    if (error.isNetworkError) {
      return t('common:errors.network', {
        defaultValue: 'Could not reach MandiMate. Check your internet connection and try again.',
      });
    }
    if (error.status === 429) {
      return t('common:errors.tooManyRequests', {
        defaultValue: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }
    if (error.status >= 500) {
      return t('common:errors.server', {
        defaultValue: 'Something went wrong on our side. Please try again shortly.',
      });
    }
    return error.detail;
  }
  return t('common:errors.generic', { defaultValue: 'Something went wrong. Please try again.' });
}

/** Separators people type in phone numbers; the API strips the same set. */
const PHONE_SEPARATORS = /[\s\-().]/g;
const PHONE_PATTERN = /^\+?\d{10,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function compactPhone(value: string): string {
  return value.replace(PHONE_SEPARATORS, '');
}

/** Mirrors the API: digits with an optional leading "+", 10 to 15 digits after removing separators. */
export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(compactPhone(value.trim()));
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** `''` and whitespace → `null`, everything else trimmed. */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Password policy shared with the API: 8–128 characters with at least one letter and one digit. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function hasLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

export function hasDigit(value: string): boolean {
  return /\p{Nd}/u.test(value);
}

export function meetsPasswordPolicy(value: string): boolean {
  return value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX && hasLetter(value) && hasDigit(value);
}
