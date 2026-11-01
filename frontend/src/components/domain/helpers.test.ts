import { describe, expect, it } from 'vitest';

import enDomain from '@/i18n/locales/en/domain.json';
import hiDomain from '@/i18n/locales/hi/domain.json';
import teDomain from '@/i18n/locales/te/domain.json';
import type { ActionItem, LotMember, SellingOption } from '@/types/api';
import { consentFromMember, tallyConsents } from './ConsentPanel';
import { cropCodeFromLotCode, cropCodeFromName, resolveCropCode } from './crops';
import { validatePhoto } from './PhotoUploader';
import { orderSellingOptions, proceedsShares, upliftPerKg } from './proceeds';
import { deadlineUrgency, durationParts, sortActionItems } from './schedule';
import { statusLabelKey, statusTone } from './status';
import { sortRows } from './tableSort';

function option(overrides: Partial<SellingOption>): SellingOption {
  return {
    label: 'Option',
    quantity_kg: 400,
    expected_accepted_kg: 388,
    gross_price_per_kg: 16,
    gross_amount: 6400,
    lines: [],
    total_deductions: 600,
    net_amount: 5800,
    net_per_kg: 14.5,
    payment_terms_days: 7,
    confidence: 'estimated',
    unresolved: [],
    option_id: 'offer',
    source: 'pooled_offer',
    title: 'Pooled sale',
    buyer_name: 'FreshMart',
    buyer_verified: true,
    offer_status: 'pending',
    awaiting: 'seller',
    lot_id: null,
    valid_until: null,
    meets_min_price: null,
    is_best: false,
    ...overrides,
  };
}

describe('crop codes', () => {
  it('resolves catalogue codes, lot codes and names in every UI language', () => {
    expect(resolveCropCode({ code: 'tom' })).toBe('TOM');
    expect(cropCodeFromLotCode('MM-ONI-0012')).toBe('ONI');
    expect(cropCodeFromLotCode('OF-00012')).toBeNull();
    expect(cropCodeFromName('Green chilli')).toBe('CHI');
    expect(cropCodeFromName('टमाटर')).toBe('TOM');
    expect(cropCodeFromName('వంకాయ')).toBe('BRN');
    expect(cropCodeFromName('Mango (Banganapalli)')).toBe('MNG');
    expect(resolveCropCode({ code: 'XYZ', name: 'Saffron' })).toBeNull();
  });
});

describe('status tones', () => {
  it('maps every kind to a restrained tone and a common translation key', () => {
    expect(statusTone('payment', 'overdue')).toBe('danger');
    expect(statusTone('offer', 'accepted')).toBe('success');
    expect(statusTone('lot', 'awaiting_consent')).toBe('warning');
    expect(statusLabelKey('transport', 'in_progress')).toBe('common:enums.transportRequestStatus.in_progress');
    expect(statusLabelKey('consent', 'declined')).toBe('common:enums.consentDecision.declined');
  });
});

describe('selling options', () => {
  const baseline = option({ option_id: 'baseline', source: 'baseline', net_amount: 4900, net_per_kg: 12.25 });
  const pooled = option({ option_id: 'a', net_amount: 5800, net_per_kg: 14.5, is_best: true });
  const direct = option({ option_id: 'b', source: 'direct_offer', net_amount: 5300, net_per_kg: 13.25 });

  it('ranks offers by net amount and keeps the baseline last', () => {
    expect(orderSellingOptions([baseline, direct, pooled]).map((item) => item.option_id)).toEqual(['a', 'b', 'baseline']);
  });

  it('measures the uplift per kg against the baseline', () => {
    expect(upliftPerKg(pooled, baseline)).toBe(2.25);
    expect(upliftPerKg(baseline, baseline)).toBeNull();
    expect(upliftPerKg(pooled, null)).toBeNull();
  });

  it('splits gross into kept and deducted shares', () => {
    expect(proceedsShares(6400, 5800)).toEqual({ net: 5800 / 6400, deductions: 1 - 5800 / 6400, keptPct: 91 });
    expect(proceedsShares(6400, -200).net).toBe(0);
    expect(proceedsShares(0, 0)).toEqual({ net: 0, deductions: 0, keptPct: 0 });
  });
});

describe('schedule helpers', () => {
  const now = new Date('2026-10-27T06:00:00Z');

  it('rounds durations to one readable unit', () => {
    expect(durationParts(20 * 60_000)).toEqual({ unit: 'minutes', count: 20 });
    expect(durationParts(5 * 3_600_000)).toEqual({ unit: 'hours', count: 5 });
    expect(durationParts(3 * 86_400_000)).toEqual({ unit: 'days', count: 3 });
    expect(durationParts(21 * 86_400_000)).toEqual({ unit: 'weeks', count: 3 });
    expect(durationParts(-90 * 60_000)).toEqual({ unit: 'hours', count: 2 });
  });

  it('grades deadlines by urgency', () => {
    expect(deadlineUrgency('2026-10-27T05:00:00Z', now)).toBe('expired');
    expect(deadlineUrgency('2026-10-27T20:00:00Z', now)).toBe('urgent');
    expect(deadlineUrgency('2026-10-29T06:00:00Z', now)).toBe('soon');
    expect(deadlineUrgency('2026-11-10T06:00:00Z', now)).toBe('normal');
    expect(deadlineUrgency(null, now)).toBe('normal');
  });

  it('puts urgent actions first, then the earliest due', () => {
    const action = (id: string, priority: ActionItem['priority'], due: string | null): ActionItem => ({
      id,
      kind: 'offer',
      title: id,
      description: '',
      link: '/app',
      due_at: due,
      priority,
    });
    const sorted = sortActionItems([
      action('later', 'normal', '2026-10-30T00:00:00Z'),
      action('undated', 'normal', null),
      action('urgent', 'high', null),
      action('sooner', 'normal', '2026-10-28T00:00:00Z'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['urgent', 'sooner', 'later', 'undated']);
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'Lot 10', kg: 400 },
    { name: 'Lot 2', kg: null },
    { name: 'Lot 1', kg: 950 },
  ];

  it('sorts text naturally and numbers numerically', () => {
    expect(sortRows(rows, (row) => row.name, 'asc').map((row) => row.name)).toEqual(['Lot 1', 'Lot 2', 'Lot 10']);
    expect(sortRows(rows, (row) => row.kg, 'desc').map((row) => row.name)).toEqual(['Lot 1', 'Lot 10', 'Lot 2']);
  });

  it('keeps empty values last in both directions', () => {
    expect(sortRows(rows, (row) => row.kg, 'asc').map((row) => row.name)).toEqual(['Lot 10', 'Lot 1', 'Lot 2']);
  });
});

describe('consent tally', () => {
  it('counts farmers and kilograms by decision', () => {
    const member = (id: string, quantity: number, consent: LotMember['consent_status']): LotMember => ({
      id,
      lot_id: 'lot',
      harvest_id: `h-${id}`,
      farmer_id: `f-${id}`,
      farmer_name: `Farmer ${id}`,
      village: null,
      quantity_kg: quantity,
      distance_km: null,
      harvest_quality_status: 'inspected',
      consent_status: consent,
      consented_at: null,
      delivered_kg: null,
      accepted_kg: null,
      rejected_kg: null,
      rejection_reason: null,
      is_mine: false,
    });
    const tally = tallyConsents([member('a', 200, 'accepted'), member('b', 350, 'pending'), member('c', 500, 'accepted'), member('d', 100, 'declined')].map(consentFromMember));
    expect(tally).toMatchObject({ total: 4, accepted: 2, pending: 1, declined: 1, acceptedKg: 700, pendingKg: 350, declinedKg: 100, totalKg: 1150 });
  });
});

describe('validatePhoto', () => {
  it('accepts JPEG, PNG and WebP up to the size limit', () => {
    expect(validatePhoto({ type: 'image/jpeg', size: 1024 })).toBeNull();
    expect(validatePhoto({ type: 'image/gif', size: 1024 })).toBe('type');
    expect(validatePhoto({ type: 'image/webp', size: 9 * 1024 * 1024 })).toBe('size');
  });
});

describe('domain translations', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];

  it('has the same keys in English, Hindi and Telugu', () => {
    const english = flatten(enDomain).sort();
    expect(flatten(hiDomain).sort()).toEqual(english);
    expect(flatten(teDomain).sort()).toEqual(english);
  });
});
