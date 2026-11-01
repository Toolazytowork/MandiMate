import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SellingOption, SellingOptions } from '@/types/api';
import { SellingOptionsCompare } from './SellingOptionsCompare';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(ui: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}

const base: Omit<SellingOption, 'option_id' | 'source' | 'title' | 'net_amount' | 'net_per_kg' | 'is_best'> = {
  label: 'Option',
  quantity_kg: 400,
  expected_accepted_kg: 388,
  gross_price_per_kg: 16,
  gross_amount: 6400,
  lines: [],
  total_deductions: 600,
  payment_terms_days: 7,
  confidence: 'estimated',
  unresolved: [],
  buyer_name: null,
  buyer_verified: null,
  offer_status: null,
  awaiting: null,
  lot_id: null,
  valid_until: null,
  meets_min_price: true,
};

const data: SellingOptions = {
  harvest_id: 'harvest-1',
  crop_name: 'Tomato',
  quantity_kg: 400,
  min_price_per_kg: 12,
  best_option_id: 'offer-pooled',
  uplift_vs_baseline_per_kg: 2.25,
  generated_at: '2026-10-27T06:00:00Z',
  options: [
    { ...base, option_id: 'baseline', source: 'baseline', title: 'Sell alone at local mandi', net_amount: 4900, net_per_kg: 12.25, is_best: false },
    {
      ...base,
      option_id: 'offer-direct',
      source: 'direct_offer',
      title: 'Local trader',
      buyer_name: 'Sri Venkateswara Traders',
      buyer_verified: false,
      offer_status: 'pending',
      awaiting: 'seller',
      net_amount: 5300,
      net_per_kg: 13.25,
      is_best: false,
    },
    {
      ...base,
      option_id: 'offer-pooled',
      source: 'pooled_offer',
      title: 'Pooled sale · FreshMart',
      buyer_name: 'FreshMart Retail',
      buyer_verified: true,
      offer_status: 'proposed',
      awaiting: 'farmers',
      unresolved: ['Awaiting farmer consent'],
      net_amount: 5800,
      net_per_kg: 14.5,
      is_best: true,
    },
  ],
};

describe('SellingOptionsCompare', () => {
  it('ranks offers by net, marks the best and ends with the mandi baseline', () => {
    const view = mount(
      <SellingOptionsCompare data={data} renderActions={(option) => <button type="button">Accept {option.option_id}</button>} />,
    );
    const cards = Array.from(view.querySelectorAll('ol > li'));
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual([
      'Pooled sale · FreshMart',
      'Local trader',
      'Sell alone at local mandi',
    ]);
    expect(cards[0]?.textContent).toContain('Best net');
    expect(cards[1]?.textContent).not.toContain('Best net');
    expect(cards[2]?.textContent).toContain('If you sell alone at the mandi');
  });

  it('shows net per kg uplift against the mandi and actions only for real offers', () => {
    const view = mount(<SellingOptionsCompare data={data} renderActions={(option) => <button type="button">Accept {option.option_id}</button>} />);
    const cards = Array.from(view.querySelectorAll('ol > li'));
    expect(cards[0]?.textContent).toContain('+₹2.25/kg');
    expect(cards[1]?.textContent).toContain('+₹1.00/kg');
    expect(view.textContent).toContain('About ₹900 more on this harvest');
    expect(view.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(cards[2]?.textContent).not.toContain('Accept');
    expect(cards[0]?.textContent).toContain('Accept offer-pooled');
  });

  it('explains an empty comparison', () => {
    const view = mount(<SellingOptionsCompare data={{ ...data, options: [], best_option_id: null, uplift_vs_baseline_per_kg: null }} />);
    expect(view.textContent).toContain('No offers yet');
  });
});
