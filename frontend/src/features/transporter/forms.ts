import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { z } from 'zod';

import { isApiError } from '@/lib/api';

export interface NumberFieldOptions {
  required: string;
  invalid: string;
  min?: { value: number; message: string; inclusive?: boolean };
  max?: { value: number; message: string };
}

/**
 * A text input that must hold a number. Form state stays a string (what the input produces) and
 * the parsed output is a number, so `handleSubmit` receives API-ready values.
 */
export function numberField({ required, invalid, min, max }: NumberFieldOptions) {
  return z
    .string()
    .trim()
    .min(1, required)
    .refine((value) => Number.isFinite(Number(value.replace(/,/g, ''))), invalid)
    .transform((value) => Number(value.replace(/,/g, '')))
    .superRefine((value, ctx) => {
      if (min && (min.inclusive === false ? value <= min.value : value < min.value)) {
        ctx.addIssue({ code: 'custom', message: min.message });
      }
      if (max && value > max.value) ctx.addIssue({ code: 'custom', message: max.message });
    });
}

/** Optional free text: blank → null. */
export function optionalText(maxLength: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(maxLength, tooLong)
    .transform((value) => (value.length > 0 ? value : null));
}

/**
 * Maps a 422 `ApiError.fieldErrors` onto the form. Returns true when at least one message landed on
 * a field, so the caller can skip the generic toast.
 */
export function applyApiFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  aliases: Partial<Record<string, Path<T>>> = {},
): boolean {
  if (!isApiError(error)) return false;
  let applied = false;
  for (const [key, message] of Object.entries(error.fieldErrors)) {
    const field = aliases[key] ?? (fields.includes(key as Path<T>) ? (key as Path<T>) : undefined);
    if (!field) continue;
    setError(field, { type: 'server', message }, { shouldFocus: !applied });
    applied = true;
  }
  return applied;
}

/** The human message of any thrown value. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) return error.detail || fallback;
  return fallback;
}
