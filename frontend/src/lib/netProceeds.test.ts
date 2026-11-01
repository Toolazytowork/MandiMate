import { describe, expect, it } from 'vitest';

import type { NetProceeds } from '@/types/api';

import {
  baselineNetProceeds,
  calculate,
  computeNetProceeds,
  estimateTransportCost,
  formatNoteNumber,
  formatNoteRupees,
  haversineKm,
  LINE_ORDER,
  overallConfidence,
  PLATFORM_FEE_NOTE,
  roadKm,
  roundMoney,
  UNRESOLVED_QUALITY,
  UNRESOLVED_TRANSPORT_LOCATION,
} from './netProceeds';

const line = (result: NetProceeds, key: string) => result.lines.find((item) => item.key === key)!;

describe('estimateTransportCost', () => {
  it('picks the smallest vehicle that carries the load in one trip', () => {
    expect(estimateTransportCost(1000, 30)).toEqual({
      vehicle_type: 'pickup',
      capacity_kg: 1500,
      trips: 1,
      distance_km: 30,
      cost_total: 1620,
      cost_per_kg: 1.62,
      utilization_pct: 66.67,
    });
  });

  it('uses the largest class with several trips when nothing fits', () => {
    const estimate = estimateTransportCost(12000, 20);
    expect(estimate.vehicle_type).toBe('medium_truck');
    expect(estimate.trips).toBe(2);
    expect(estimate.cost_total).toBe(2 * (2500 + 45 * 20));
    expect(estimate.utilization_pct).toBe(66.67);
  });

  it('only uses refrigerated vehicles for cold-chain loads, and nothing for no load', () => {
    expect(estimateTransportCost(3000, 10, true).vehicle_type).toBe('reefer_truck');
    expect(estimateTransportCost(12000, 10, true).trips).toBe(3);
    expect(estimateTransportCost(0, 10)).toMatchObject({ trips: 0, cost_total: 0, utilization_pct: 0 });
  });

  it('rejects negative inputs', () => {
    expect(() => estimateTransportCost(-1, 10)).toThrow(RangeError);
  });
});

describe('calculate (public calculator)', () => {
  const result = calculate({
    quantity_kg: 1000,
    price_per_kg: 16,
    distance_km: 30,
    expected_rejection_pct: 5,
    payment_terms_days: 7,
  });

  it('follows the formula of DOMAIN_RULES §3', () => {
    expect(result.gross_amount).toBe(16000);
    expect(line(result, 'rejection').amount).toBe(-800);
    expect(line(result, 'transport').amount).toBe(-1620);
    expect(line(result, 'handling').amount).toBe(-250);
    expect(line(result, 'commission').amount).toBe(0);
    expect(line(result, 'payment_wait').amount).toBe(-52.47);
    expect(line(result, 'platform_fee').amount).toBe(0);
    expect(result.net_amount).toBe(13277.53);
    expect(result.net_per_kg).toBe(13.28);
    expect(result.total_deductions).toBe(2722.47);
    expect(result.expected_accepted_kg).toBe(950);
  });

  it('nets exactly the sum of the rounded lines', () => {
    const sum = result.lines.reduce((total, item) => total + item.amount, 0);
    expect(result.net_amount).toBe(roundMoney(sum));
    expect(result.net_amount).toBe(roundMoney(result.gross_amount - result.total_deductions));
  });

  it('keeps the canonical line order, notes and certainty', () => {
    expect(result.lines.map((item) => item.key)).toEqual(LINE_ORDER);
    expect(line(result, 'gross')).toMatchObject({ certainty: 'estimated', note: '1,000 kg × ₹16.00/kg' });
    expect(line(result, 'transport')).toMatchObject({
      certainty: 'estimated',
      note: 'Estimated: Pickup, 1 trip, 30 km',
    });
    expect(line(result, 'commission')).toMatchObject({ certainty: 'confirmed', note: 'No commission' });
    expect(line(result, 'payment_wait').note).toBe('Cost of waiting 7 days at 18%/yr');
    expect(line(result, 'platform_fee')).toMatchObject({ certainty: 'confirmed', note: PLATFORM_FEE_NOTE });
    expect(result.confidence).toBe('estimated');
    expect(result.unresolved).toEqual([]);
  });

  it('treats an entered transport total as confirmed', () => {
    const explicit = calculate({ quantity_kg: 1000, price_per_kg: 16, transport_cost_total: 900, distance_km: 30 });
    expect(line(explicit, 'transport')).toMatchObject({
      amount: -900,
      certainty: 'confirmed',
      note: 'Transport cost you entered',
    });
  });

  it('applies the documented defaults when fields are left out', () => {
    const minimal = calculate({ quantity_kg: 500, price_per_kg: 20 });
    expect(line(minimal, 'transport')).toMatchObject({ amount: 0, certainty: 'estimated', note: 'Not included' });
    expect(line(minimal, 'rejection')).toMatchObject({
      amount: -500,
      note: 'Expected 5% rejection (typical for fresh produce)',
    });
    expect(line(minimal, 'handling')).toMatchObject({
      amount: -125,
      note: 'Loading & crates at the collection point, ₹0.25/kg',
    });
    expect(line(minimal, 'payment_wait')).toMatchObject({ amount: 0, note: 'Paid on delivery' });
    expect(minimal.payment_terms_days).toBe(0);
  });

  it('uses an entered handling charge as is and applies commission to the accepted value', () => {
    const entered = calculate({
      quantity_kg: 100,
      price_per_kg: 10,
      transport_cost_total: 0,
      handling_charge_per_kg: 1,
      commission_pct: 10,
      expected_rejection_pct: 20,
    });
    expect(line(entered, 'handling')).toMatchObject({ amount: -100, note: '₹1.00/kg you entered' });
    expect(line(entered, 'commission')).toMatchObject({ amount: -80, note: '10% of the accepted value' });
  });
});

describe('computeNetProceeds', () => {
  const base = {
    label: 'Delivered',
    quantityKg: 100,
    pricePerKg: 10,
    transportCost: 0,
    transportCertainty: 'confirmed' as const,
    rejectionPct: 0,
    rejectionCertainty: 'confirmed' as const,
    handlingPerKg: 0,
    commissionPct: 0,
    commissionCertainty: 'confirmed' as const,
    paymentTermsDays: 0,
    handlingCertainty: 'confirmed' as const,
  };

  it('is confirmed only when every line is confirmed (payment wait is always an estimate)', () => {
    expect(computeNetProceeds(base).confidence).toBe('estimated');
    expect(overallConfidence(['confirmed', 'confirmed'])).toBe('confirmed');
    expect(overallConfidence(['confirmed', 'estimated', 'unresolved'])).toBe('unresolved');
  });

  it('adds the derived open conditions once, after the caller’s', () => {
    const result = computeNetProceeds({
      ...base,
      rejectionCertainty: 'unresolved',
      transportCertainty: 'unresolved',
      unresolved: ['Transport quote pending', UNRESOLVED_QUALITY],
    });
    expect(result.confidence).toBe('unresolved');
    expect(result.unresolved).toEqual(['Transport quote pending', UNRESOLVED_QUALITY, UNRESOLVED_TRANSPORT_LOCATION]);
  });

  it('rejects percentages outside 0–100', () => {
    expect(() => computeNetProceeds({ ...base, commissionPct: 120 })).toThrow(RangeError);
  });
});

describe('baselineNetProceeds', () => {
  it('prices the mandi alternative with mandi handling and commission', () => {
    const baseline = baselineNetProceeds({ quantityKg: 500, marketPricePerKg: 14, defaultRejectionPct: 8 })!;
    expect(baseline.label).toBe('Sell alone at local mandi');
    expect(line(baseline, 'transport')).toMatchObject({
      amount: -1050,
      note: 'Mini truck hired alone, 25 km to the mandi',
    });
    expect(line(baseline, 'handling').amount).toBe(-250);
    expect(line(baseline, 'commission')).toMatchObject({ amount: -515.2, note: 'Commission agent at 8%' });
    expect(line(baseline, 'payment_wait').amount).toBe(-3.18);
    expect(baseline.net_amount).toBe(4621.62);
    expect(baseline.confidence).toBe('estimated');
  });

  it('labels illustrative prices and is unavailable without a market price', () => {
    const illustrative = baselineNetProceeds({
      quantityKg: 100,
      marketPricePerKg: 12,
      defaultRejectionPct: 5,
      isIllustrative: true,
      marketName: 'Madanapalle',
    })!;
    expect(line(illustrative, 'gross').note).toBe('Illustrative modal price at Madanapalle (not live market data)');
    expect(baselineNetProceeds({ quantityKg: 500, marketPricePerKg: null, defaultRejectionPct: 8 })).toBeNull();
  });
});

describe('helpers', () => {
  it('round half up without binary artefacts or negative zero', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true);
  });

  it('format note numbers like the backend', () => {
    expect(formatNoteNumber(1240000.5)).toBe('12,40,000.5');
    expect(formatNoteNumber(18)).toBe('18');
    expect(formatNoteRupees(1050)).toBe('₹1,050.00');
  });

  it('estimates road distance as great-circle × road factor, to 0.1 km', () => {
    // Madanapalle → Tirupati: 99.42 km great-circle.
    expect(haversineKm(13.5503, 78.5029, 13.6288, 79.4192)).toBe(99.42);
    expect(roadKm(13.5503, 78.5029, 13.6288, 79.4192)).toBe(129.2);
  });
});
