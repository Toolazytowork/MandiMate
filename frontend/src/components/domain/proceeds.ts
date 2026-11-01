import type { SellingOption } from '@/types/api';

export interface ProceedsShares {
  /** Fraction of the gross the farmer keeps, 0..1. */
  net: number;
  /** Fraction lost to deductions, 0..1 (always `1 - net` when there is a gross). */
  deductions: number;
  /** Whole-number percentage kept, for labels. */
  keptPct: number;
}

/** Splits a gross amount into the kept and deducted shares for the gross → net bar. */
export function proceedsShares(grossAmount: number, netAmount: number): ProceedsShares {
  if (!(grossAmount > 0) || !Number.isFinite(netAmount)) return { net: 0, deductions: 0, keptPct: 0 };
  const net = Math.min(1, Math.max(0, netAmount / grossAmount));
  return { net, deductions: 1 - net, keptPct: Math.round(net * 100) };
}

/** The baseline ("sell alone at the mandi") option, when the API could compute one. */
export function findBaseline(options: readonly SellingOption[]): SellingOption | null {
  return options.find((option) => option.source === 'baseline') ?? null;
}

/**
 * Offers ranked by what the farmer takes home (net amount, then net per kg), with the baseline
 * always last as the point of comparison.
 */
export function orderSellingOptions(options: readonly SellingOption[]): SellingOption[] {
  const offers = options
    .filter((option) => option.source !== 'baseline')
    .sort((a, b) => b.net_amount - a.net_amount || b.net_per_kg - a.net_per_kg);
  const baseline = findBaseline(options);
  return baseline ? [...offers, baseline] : offers;
}

/** ₹/kg an option nets above (or below) the baseline; `null` for the baseline itself or without one. */
export function upliftPerKg(option: SellingOption, baseline: SellingOption | null): number | null {
  if (!baseline || option.source === 'baseline') return null;
  return Math.round((option.net_per_kg - baseline.net_per_kg) * 100) / 100;
}
