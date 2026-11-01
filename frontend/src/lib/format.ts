/**
 * Display formatting for money, quantities, percentages and dates.
 *
 * Numbers always use Indian digit grouping (12,40,000) with Latin digits in every UI language.
 * Date-times are shown in India Standard Time so SSR output and every browser agree.
 * Nullish or non-finite inputs render as an em dash.
 */
import { i18n, languageDir } from '@/lib/i18n';
import type { Language } from '@/types/api';

export const EMPTY_VALUE = '—';
const MINUS = '−';
const TIME_ZONE = 'Asia/Kolkata';
const NUMBER_LOCALE = 'en-IN';

// Urdu dates keep Western digits (ur-IN would default to Extended Arabic-Indic), like every other number in the app.
const LOCALE_TAGS: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ur: 'ur-IN-u-nu-latn' };

type Numeric = number | null | undefined;

function isNumber(value: Numeric): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();

function numberFormat(minFractionDigits: number, maxFractionDigits: number): Intl.NumberFormat {
  const key = `${minFractionDigits}:${maxFractionDigits}`;
  let format = numberFormatCache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(NUMBER_LOCALE, {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    });
    numberFormatCache.set(key, format);
  }
  return format;
}

/** Rounds half away from zero, avoiding binary artefacts such as 1.005 → 1.00. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON * factor)) / factor;
}

/** Sign prefix for an already-rounded value (never "−0"). */
function signOf(rounded: number, signed: boolean): string {
  if (rounded < 0) return MINUS;
  if (signed && rounded > 0) return '+';
  return '';
}

/* ─────────────────────────────── Numbers ─────────────────────────────── */

export interface FormatNumberOptions {
  /** Fixed number of fraction digits. Default: up to `maxDecimals`. */
  decimals?: number;
  /** Upper bound when `decimals` is not given. Default 0. */
  maxDecimals?: number;
  /** Prefix positive values with "+". */
  signed?: boolean;
}

export function formatNumber(value: Numeric, { decimals, maxDecimals = 0, signed = false }: FormatNumberOptions = {}): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  const max = decimals ?? maxDecimals;
  const rounded = roundTo(value, max);
  return signOf(rounded, signed) + numberFormat(decimals ?? 0, max).format(Math.abs(rounded));
}

/* ──────────────────────────────── Money ──────────────────────────────── */

export interface FormatINROptions {
  /** Fixed fraction digits. Default: 2 when the amount has paise, otherwise 0 (compact: up to 1). */
  decimals?: number;
  /** Indian short scale: ₹6.4K, ₹12.4L (lakh), ₹1.2Cr (crore). */
  compact?: boolean;
  /** Prefix positive amounts with "+". */
  signed?: boolean;
}

const COMPACT_UNITS: { size: number; suffix: string }[] = [
  { size: 1e7, suffix: 'Cr' },
  { size: 1e5, suffix: 'L' },
  { size: 1e3, suffix: 'K' },
];

/**
 * In a right-to-left UI (Urdu) a rupee amount such as "₹11.06" sits inside RTL text, where the bidi
 * algorithm would reorder its sign, symbol and unit. Wrapping it in an invisible left-to-right isolate keeps
 * it reading "₹11.06" (and "₹11.06/کلو" around it) without touching left-to-right languages.
 */
function isolateForRtl(text: string): string {
  return languageDir(i18n.language) === 'rtl' ? `\u2066${text}\u2069` : text;
}

/** Indian rupees, e.g. `formatINR(1240000)` → "₹12,40,000"; `formatINR(1240000, { compact: true })` → "₹12.4L". */
export function formatINR(value: Numeric, options: FormatINROptions = {}): string {
  return isolateForRtl(formatRupees(value, options));
}

function formatRupees(value: Numeric, { decimals, compact = false, signed = false }: FormatINROptions = {}): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);

  if (compact) {
    const unit = COMPACT_UNITS.find((candidate) => abs >= candidate.size);
    if (unit) {
      const max = decimals ?? 1;
      const scaled = roundTo(abs / unit.size, max);
      const sign = signOf(value < 0 ? -scaled : scaled, signed);
      return `${sign}₹${numberFormat(decimals ?? 0, max).format(scaled)}${unit.suffix}`;
    }
  }

  const hasPaise = Math.round(abs * 100) % 100 !== 0;
  const digits = decimals ?? (hasPaise ? 2 : 0);
  const rounded = roundTo(value, digits);
  return `${signOf(rounded, signed)}₹${numberFormat(digits, digits).format(Math.abs(rounded))}`;
}

/** Price per kilogram with paise, e.g. "₹16.00/kg". */
export function formatPerKg(value: Numeric, { signed = false }: { signed?: boolean } = {}): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  return i18n.t('common:units.perKgValue', { value: formatINR(value, { decimals: 2, signed }) });
}

/* ───────────────────────────── Quantities ────────────────────────────── */

const TONNE_THRESHOLD_KG = 10_000;

/** Kilograms, switching to tonnes from 10,000 kg: "1,250 kg", "12.5 t" (unit words follow the UI language). */
export function formatKg(value: Numeric): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  if (Math.abs(value) >= TONNE_THRESHOLD_KG) {
    return `${formatNumber(value / 1000, { maxDecimals: 1 })} ${i18n.t('common:units.tonneShort')}`;
  }
  return i18n.t('common:units.kgValue', { value: formatNumber(value, { maxDecimals: 1 }) });
}

/** Percentages with up to one decimal by default: "82%", "3.5%", "+4.2%" when signed. */
export function formatPct(value: Numeric, { decimals, signed = false }: { decimals?: number; signed?: boolean } = {}): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  return `${formatNumber(value, { decimals, maxDecimals: 1, signed })}%`;
}

/* ─────────────────────────────── Dates ───────────────────────────────── */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

type DateInput = string | Date | null | undefined;

interface ParsedDate {
  date: Date;
  /** Calendar dates ('YYYY-MM-DD') carry no time and are formatted in UTC to avoid day shifts. */
  dateOnly: boolean;
}

function parseDate(value: DateInput): ParsedDate | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { date: value, dateOnly: false };
  const match = ISO_DATE.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return { date: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))), dateOnly: true };
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: Language, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = dateFormatCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { ...options, timeZone });
    dateFormatCache.set(key, format);
  }
  return format;
}

interface LocaleOption {
  locale?: Language;
}

/** "28 Oct 2026". Accepts ISO dates, ISO date-times or Date objects. */
export function formatDate(value: DateInput, { locale = 'en' }: LocaleOption = {}): string {
  const parsed = parseDate(value);
  if (!parsed) return EMPTY_VALUE;
  return dateFormat(locale, parsed.dateOnly ? 'UTC' : TIME_ZONE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed.date);
}

/** "28 Oct 2026, 9:30 am" in India Standard Time. */
export function formatDateTime(value: DateInput, { locale = 'en' }: LocaleOption = {}): string {
  const parsed = parseDate(value);
  if (!parsed) return EMPTY_VALUE;
  if (parsed.dateOnly) return formatDate(value, { locale });
  return dateFormat(locale, TIME_ZONE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed.date);
}

/** "9:30 am" in India Standard Time. */
export function formatTime(value: DateInput, { locale = 'en' }: LocaleOption = {}): string {
  const parsed = parseDate(value);
  if (!parsed || parsed.dateOnly) return EMPTY_VALUE;
  return dateFormat(locale, TIME_ZONE, { hour: 'numeric', minute: '2-digit' }).format(parsed.date);
}

/** Today's calendar date in India ('YYYY-MM-DD') — the business "today" used by every rule. */
export function todayIST(now: Date = new Date()): string {
  const parts = dateFormat('en', TIME_ZONE, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

type RelativeUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

const EN_UNIT_LABELS: Record<RelativeUnit, [singular: string, plural: string]> = {
  minute: ['min', 'min'],
  hour: ['h', 'h'],
  day: ['day', 'days'],
  month: ['mo', 'mo'],
  year: ['yr', 'yr'],
};

function relativePhrase(amount: number, unit: RelativeUnit, locale: Language): string {
  if (locale !== 'en') {
    return new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: 'auto' }).format(amount, unit);
  }
  const abs = Math.abs(amount);
  const [singular, plural] = EN_UNIT_LABELS[unit];
  const phrase = `${abs} ${abs === 1 ? singular : plural}`;
  return amount < 0 ? `${phrase} ago` : `in ${phrase}`;
}

function relativeDays(days: number, locale: Language): string {
  if (locale !== 'en') {
    return new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: 'auto' }).format(days, 'day');
  }
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return relativePhrase(days, 'day', locale);
}

/**
 * Human relative time: "just now", "in 20 min", "3 h ago", "in 2 days".
 * Calendar dates ('YYYY-MM-DD') compare against today's date in India: "today", "tomorrow", "in 3 days".
 */
export function formatRelative(value: DateInput, { now = new Date(), locale = 'en' }: LocaleOption & { now?: Date } = {}): string {
  const parsed = parseDate(value);
  if (!parsed) return EMPTY_VALUE;

  if (parsed.dateOnly) {
    const today = parseDate(todayIST(now));
    if (!today) return EMPTY_VALUE;
    return relativeDays(Math.round((parsed.date.getTime() - today.date.getTime()) / DAY_MS), locale);
  }

  const diffSeconds = (parsed.date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diffSeconds);
  const direction = diffSeconds < 0 ? -1 : 1;

  if (abs < 45) {
    return locale === 'en' ? 'just now' : new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: 'auto' }).format(0, 'second');
  }
  if (abs < 45 * 60) return relativePhrase(direction * Math.max(1, Math.round(abs / 60)), 'minute', locale);
  if (abs < 22 * 3600) return relativePhrase(direction * Math.round(abs / 3600), 'hour', locale);
  if (abs < 26 * 86_400) return relativePhrase(direction * Math.round(abs / 86_400), 'day', locale);
  if (abs < 320 * 86_400) return relativePhrase(direction * Math.round(abs / (30.44 * 86_400)), 'month', locale);
  return relativePhrase(direction * Math.max(1, Math.round(abs / (365.25 * 86_400))), 'year', locale);
}

/* ─────────────────────────────── People ──────────────────────────────── */

function firstGrapheme(word: string): string {
  if (typeof Intl.Segmenter === 'function') {
    const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)[Symbol.iterator]().next();
    return segment.done ? '' : segment.value.segment;
  }
  return Array.from(word)[0] ?? '';
}

/** Up to two initials from the first and last word: "Ravi Kumar Reddy" → "RR", "Lakshmi" → "L". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = firstGrapheme(words[0]!);
  const last = words.length > 1 ? firstGrapheme(words[words.length - 1]!) : '';
  return (first + last).toLocaleUpperCase('en-IN');
}
