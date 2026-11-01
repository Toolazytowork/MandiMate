import { describe, expect, it } from 'vitest';

import {
  EMPTY_VALUE,
  formatDate,
  formatDateTime,
  formatINR,
  formatKg,
  formatNumber,
  formatPct,
  formatPerKg,
  formatRelative,
  initials,
  todayIST,
} from './format';

describe('formatINR', () => {
  it('uses Indian digit grouping and drops zero paise', () => {
    expect(formatINR(1240000)).toBe('₹12,40,000');
    expect(formatINR(16000)).toBe('₹16,000');
    expect(formatINR(0)).toBe('₹0');
  });

  it('shows paise when present, or a fixed number of decimals on request', () => {
    expect(formatINR(6400.5)).toBe('₹6,400.50');
    expect(formatINR(1.005, { decimals: 2 })).toBe('₹1.01');
    expect(formatINR(1250, { decimals: 2 })).toBe('₹1,250.00');
  });

  it('formats negatives with a true minus sign and optional plus for positives', () => {
    expect(formatINR(-1250)).toBe('−₹1,250');
    expect(formatINR(320, { signed: true })).toBe('+₹320');
    expect(formatINR(-0.001)).toBe('₹0');
  });

  it('abbreviates with the Indian short scale', () => {
    expect(formatINR(1240000, { compact: true })).toBe('₹12.4L');
    expect(formatINR(12500000, { compact: true })).toBe('₹1.3Cr');
    expect(formatINR(6400, { compact: true })).toBe('₹6.4K');
    expect(formatINR(950, { compact: true })).toBe('₹950');
    expect(formatINR(-250000, { compact: true })).toBe('−₹2.5L');
  });

  it('renders an em dash for missing values', () => {
    expect(formatINR(null)).toBe(EMPTY_VALUE);
    expect(formatINR(undefined)).toBe(EMPTY_VALUE);
    expect(formatINR(Number.NaN)).toBe(EMPTY_VALUE);
  });
});

describe('formatPerKg / formatKg / formatPct / formatNumber', () => {
  it('always shows paise per kilogram', () => {
    expect(formatPerKg(16)).toBe('₹16.00/kg');
    expect(formatPerKg(1.5, { signed: true })).toBe('+₹1.50/kg');
    expect(formatPerKg(null)).toBe(EMPTY_VALUE);
  });

  it('switches to tonnes from 10,000 kg', () => {
    expect(formatKg(1250)).toBe('1,250 kg');
    expect(formatKg(412.5)).toBe('412.5 kg');
    expect(formatKg(9999)).toBe('9,999 kg');
    expect(formatKg(12500)).toBe('12.5 t');
    expect(formatKg(10000)).toBe('10 t');
  });

  it('formats percentages with up to one decimal', () => {
    expect(formatPct(82)).toBe('82%');
    expect(formatPct(3.456)).toBe('3.5%');
    expect(formatPct(4.2, { signed: true })).toBe('+4.2%');
    expect(formatPct(12, { decimals: 1 })).toBe('12.0%');
  });

  it('formats plain numbers with Indian grouping', () => {
    expect(formatNumber(1234567)).toBe('12,34,567');
    expect(formatNumber(2.345, { maxDecimals: 2 })).toBe('2.35');
  });
});

describe('dates', () => {
  it('formats calendar dates without timezone drift', () => {
    expect(formatDate('2026-10-28')).toBe('28 Oct 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('formats instants in India Standard Time', () => {
    // 22:30 UTC is 04:00 the next day in IST.
    expect(formatDate('2026-10-27T22:30:00Z')).toBe('28 Oct 2026');
    expect(formatDateTime('2026-10-28T04:00:00Z')).toBe('28 Oct 2026, 9:30 am');
  });

  it('computes today in IST', () => {
    expect(todayIST(new Date('2026-10-27T20:00:00Z'))).toBe('2026-10-28');
    expect(todayIST(new Date('2026-10-27T10:00:00Z'))).toBe('2026-10-27');
  });

  it('returns an em dash for invalid input', () => {
    expect(formatDate('not a date')).toBe(EMPTY_VALUE);
    expect(formatDate(null)).toBe(EMPTY_VALUE);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-27T06:30:00Z'); // 12:00 IST

  it('describes instants relative to now', () => {
    expect(formatRelative('2026-10-27T06:29:40Z', { now })).toBe('just now');
    expect(formatRelative('2026-10-27T06:10:00Z', { now })).toBe('20 min ago');
    expect(formatRelative('2026-10-27T03:30:00Z', { now })).toBe('3 h ago');
    expect(formatRelative('2026-10-29T06:30:00Z', { now })).toBe('in 2 days');
    expect(formatRelative('2026-10-28T06:30:00Z', { now })).toBe('in 1 day');
  });

  it('compares calendar dates with today in India', () => {
    expect(formatRelative('2026-10-27', { now })).toBe('today');
    expect(formatRelative('2026-10-28', { now })).toBe('tomorrow');
    expect(formatRelative('2026-10-26', { now })).toBe('yesterday');
    expect(formatRelative('2026-10-30', { now })).toBe('in 3 days');
    expect(formatRelative('2026-10-20', { now })).toBe('7 days ago');
  });

  it('localises through Intl for Hindi and Telugu', () => {
    const hindi = formatRelative('2026-10-28', { now, locale: 'hi' });
    const telugu = formatRelative('2026-10-28', { now, locale: 'te' });
    expect(hindi).not.toBe('tomorrow');
    expect(telugu).not.toBe('tomorrow');
    expect(hindi.length).toBeGreaterThan(0);
  });
});

describe('initials', () => {
  it('takes the first letter of the first and last names', () => {
    expect(initials('Ravi Kumar Reddy')).toBe('RR');
    expect(initials('lakshmi')).toBe('L');
    expect(initials('  ')).toBe('');
    expect(initials(null)).toBe('');
  });

  it('keeps a consonant together with its vowel sign', () => {
    expect(initials('రవి కుమార్')).toBe('రకు');
    expect(initials('सुनीता देवी')).toBe('सुदे');
  });
});
