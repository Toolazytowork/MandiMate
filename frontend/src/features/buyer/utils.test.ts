import { describe, expect, it } from 'vitest';
import type { Lot, LotMember, NegotiationEntry, Offer, Settlement } from '@/types/api';
import {
  addDays,
  buyerOfferActions,
  canRecordDelivery,
  daysUntil,
  deliveryLine,
  deliveryTotals,
  dispatchedByMember,
  farmerView,
  isOverdue,
  landedCost,
  lastBuyerPrice,
  lotQualityStatus,
  offerBucket,
  openOfferByTarget,
  ordersFrom,
  outstandingAmount,
  paidAtFromDate,
  parseAmount,
  paymentSummary,
  safeFarmerView,
  validUntilFromNow,
} from './utils';

const member = (overrides: Partial<LotMember>): LotMember => ({
  id: 'm1',
  lot_id: 'l1',
  harvest_id: 'h1',
  farmer_id: 'f1',
  farmer_name: 'Ravi K.',
  village: 'Kurabalakota',
  quantity_kg: 400,
  distance_km: 4,
  harvest_quality_status: 'inspected',
  consent_status: 'accepted',
  consented_at: null,
  delivered_kg: null,
  accepted_kg: null,
  rejected_kg: null,
  rejection_reason: null,
  is_mine: false,
  ...overrides,
});

const entry = (overrides: Partial<NegotiationEntry>): NegotiationEntry => ({
  id: 'n',
  author_id: null,
  author_name: 'x',
  author_role: 'buyer',
  action: 'offer',
  price_per_kg: null,
  quantity_kg: null,
  payment_terms_days: null,
  message: null,
  created_at: '2026-10-20T10:00:00Z',
  ...overrides,
});

const settlement = (overrides: Partial<Settlement>): Settlement =>
  ({
    id: 's1',
    code: 'ST-00001',
    gross_amount: 10000,
    amount_paid: 0,
    payment_status: 'pending',
    due_date: '2026-10-30',
    payments: [],
    payouts: [],
    ...overrides,
  }) as Settlement;

describe('offers', () => {
  it('buckets offers by who acts next', () => {
    expect(offerBucket({ status: 'countered', awaiting: 'buyer' })).toBe('yours');
    expect(offerBucket({ status: 'pending', awaiting: 'seller' })).toBe('seller');
    expect(offerBucket({ status: 'proposed', awaiting: 'farmers' })).toBe('seller');
    expect(offerBucket({ status: 'accepted', awaiting: null })).toBe('accepted');
    expect(offerBucket({ status: 'expired', awaiting: null })).toBe('closed');
  });

  it('only offers buyer actions the API allows', () => {
    expect(buyerOfferActions({ status: 'countered', awaiting: 'buyer' })).toEqual({
      acceptCounter: true,
      counter: true,
      reject: true,
      withdraw: true,
    });
    expect(buyerOfferActions({ status: 'pending', awaiting: 'seller' })).toEqual({
      acceptCounter: false,
      counter: false,
      reject: false,
      withdraw: true,
    });
    expect(buyerOfferActions({ status: 'accepted', awaiting: null }).withdraw).toBe(false);
  });

  it('finds the buyer’s last written price', () => {
    const offer = {
      negotiation: [
        entry({ id: 'a', price_per_kg: 15, created_at: '2026-10-20T10:00:00Z' }),
        entry({ id: 'b', author_role: 'coordinator', price_per_kg: 18, created_at: '2026-10-21T10:00:00Z' }),
        entry({ id: 'c', price_per_kg: 16, created_at: '2026-10-22T10:00:00Z' }),
        entry({ id: 'd', author_role: 'coordinator', price_per_kg: 17, created_at: '2026-10-23T10:00:00Z' }),
      ],
    };
    expect(lastBuyerPrice(offer)).toBe(16);
  });

  it('maps open offers to their target', () => {
    const offers = [
      { id: 'o1', status: 'rejected', target_type: 'lot', lot_id: 'L', harvest_id: null },
      { id: 'o2', status: 'pending', target_type: 'lot', lot_id: 'L', harvest_id: null },
      { id: 'o3', status: 'countered', target_type: 'harvest', lot_id: null, harvest_id: 'H' },
    ] as Offer[];
    const map = openOfferByTarget(offers);
    expect(map.get('L')?.id).toBe('o2');
    expect(map.get('H')?.id).toBe('o3');
  });
});

describe('orders', () => {
  it('keeps only lots won by the buyer’s own accepted offers', () => {
    const lots = [
      { id: 'l1', accepted_offer_id: 'mine' },
      { id: 'l2', accepted_offer_id: 'someone-else' },
      { id: 'l3', accepted_offer_id: null },
    ] as Lot[];
    const orders = ordersFrom(lots, [{ id: 'mine' } as Offer]);
    expect(orders.map((order) => order.lot.id)).toEqual(['l1']);
  });

  it('opens delivery recording at the right moment', () => {
    expect(canRecordDelivery({ status: 'offer_accepted', pickup_terms: 'buyer_pickup' })).toBe(true);
    expect(canRecordDelivery({ status: 'offer_accepted', pickup_terms: 'mandimate_delivery' })).toBe(false);
    expect(canRecordDelivery({ status: 'in_transit', pickup_terms: 'mandimate_delivery' })).toBe(true);
    expect(canRecordDelivery({ status: 'delivered', pickup_terms: 'mandimate_delivery' })).toBe(false);
  });

  it('rates a lot by its least-inspected member, ignoring declined farmers', () => {
    expect(lotQualityStatus([member({}), member({ id: 'm2', harvest_quality_status: 'pending_inspection' })])).toBe(
      'pending_inspection',
    );
    expect(
      lotQualityStatus([member({}), member({ id: 'm2', harvest_quality_status: 'self_reported', consent_status: 'declined' })]),
    ).toBe('inspected');
  });
});

describe('delivery', () => {
  it('uses picked-up weights when the pickup was confirmed', () => {
    const members = [member({ id: 'a', quantity_kg: 400 }), member({ id: 'b', quantity_kg: 300 }), member({ id: 'c', consent_status: 'declined' })];
    const dispatched = dispatchedByMember(members, {
      stops: [{ member_id: 'a', picked_kg: 390 }] as never,
    });
    expect([...dispatched.entries()]).toEqual([
      ['a', 390],
      ['b', 300],
    ]);
  });

  it('computes rejection, shortage and the 2% tolerance', () => {
    const line = deliveryLine({ dispatched: 500, delivered: 480, accepted: 450 });
    expect(line.rejected).toBe(30);
    expect(line.shortage).toBe(20);
    expect(line.maxDelivered).toBe(510);
    expect(line.overLimit).toBe(false);
    expect(deliveryLine({ dispatched: 500, delivered: 511, accepted: 500 }).overLimit).toBe(true);
    expect(deliveryLine({ dispatched: 500, delivered: 400, accepted: 450 }).acceptedAboveDelivered).toBe(true);
  });

  it('totals the lot', () => {
    const totals = deliveryTotals([
      { dispatched: 500, delivered: 480, accepted: 450 },
      { dispatched: 300, delivered: 300, accepted: 300 },
      { dispatched: 200, delivered: null, accepted: null },
    ]);
    expect(totals).toMatchObject({ dispatched: 1000, delivered: 780, accepted: 750, rejected: 30, shortage: 20, complete: false });
  });
});

describe('settlements', () => {
  it('tracks the outstanding balance and overdue status', () => {
    const owed = settlement({ amount_paid: 2500.5 });
    expect(outstandingAmount(owed)).toBe(7499.5);
    expect(isOverdue(owed, '2026-10-31')).toBe(true);
    expect(isOverdue(owed, '2026-10-29')).toBe(false);
    expect(isOverdue(settlement({ amount_paid: 9999.995 }), '2026-11-30')).toBe(false);
  });

  it('summarises what is owed', () => {
    const summary = paymentSummary(
      [
        settlement({ id: 'a', gross_amount: 1000, amount_paid: 0, due_date: '2026-10-20' }),
        settlement({ id: 'b', gross_amount: 2000, amount_paid: 500, due_date: '2026-11-05' }),
        settlement({ id: 'c', gross_amount: 3000, amount_paid: 3000, payment_status: 'paid' }),
      ],
      '2026-10-27',
    );
    expect(summary).toMatchObject({ outstanding: 2500, overdue: 1000, overdueCount: 1, paidTotal: 3500 });
    expect(summary.nextDue?.id).toBe('a');
  });

  it('counts days to a due date', () => {
    expect(daysUntil('2026-11-01', '2026-10-27')).toBe(5);
    expect(daysUntil('2026-10-25', '2026-10-27')).toBe(-2);
  });
});

describe('dates and numbers', () => {
  it('adds calendar days across months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('rounds validity presets up to the quarter hour', () => {
    const now = new Date(2026, 9, 27, 10, 7);
    expect(validUntilFromNow(24, now)).toBe('2026-10-28T10:15');
  });

  it('stamps past payment dates at midday IST', () => {
    expect(paidAtFromDate('2026-10-25', '2026-10-27')).toBe('2026-10-25T06:30:00.000Z');
  });

  it('parses amounts typed with grouping commas', () => {
    expect(parseAmount('1,24,000.50')).toBe(124000.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('landed cost and the farmers’ view', () => {
  it('prices the order and its rejection floor', () => {
    expect(landedCost({ pricePerKg: 16.5, quantityKg: 1000, maxRejectionPct: 5 })).toEqual({
      orderValue: 16500,
      floorValue: 15675,
      maxRejectedKg: 50,
    });
    expect(landedCost({ pricePerKg: null, quantityKg: 1000, maxRejectionPct: 5 }).orderValue).toBeNull();
  });

  const base = {
    pricePerKg: 16,
    quantityKg: 1000,
    pickupTerms: 'buyer_pickup' as const,
    paymentTermsDays: 7,
    maxRejectionPct: 5,
    handlingChargePerKg: 0,
    grade: 'A' as const,
    qualityStatus: 'inspected' as const,
    defaultRejectionPct: 8,
    origin: null,
    destination: null,
    marketPricePerKg: 12,
  };

  it('estimates the farmers’ net with no transport when the buyer collects', () => {
    const view = farmerView(base);
    const transport = view.offer.lines.find((line) => line.key === 'transport');
    expect(transport?.amount).toBe(0);
    expect(view.offer.net_per_kg).toBeLessThan(16);
    expect(view.baseline).not.toBeNull();
    expect(view.upliftPerKg).toBeGreaterThan(0);
  });

  it('flags unknown transport for door delivery without a destination', () => {
    expect(farmerView({ ...base, pickupTerms: 'mandimate_delivery' }).transportUnknown).toBe(true);
  });

  it('never throws on incomplete input', () => {
    expect(safeFarmerView({ ...base, pricePerKg: Number.NaN })).toBeNull();
    expect(safeFarmerView({ ...base, maxRejectionPct: 140 })).toBeNull();
  });
});
