/**
 * Query-key factory for TanStack Query. Keys are hierarchical so a whole area can be invalidated
 * at once (`keys.harvests.all`), a list family (`keys.harvests.lists()`), or one record together with
 * its sub-resources (`keys.harvests.detail(id)` also prefixes `options` and `timeline`).
 */
import type { UUID } from '@/types/api';

import type { AdminUserListParams, AuditLogParams } from './admin';
import type { CounterSuggestionParams } from './ai';
import type { DemandListParams } from './demands';
import type { DisputeListParams } from './disputes';
import type { HarvestListParams } from './harvests';
import type { LotListParams } from './lots';
import type { MarketPriceParams } from './market';
import type { NotificationListParams } from './notifications';
import type { OfferBreakdownParams, OfferListParams } from './offers';
import type { SettlementListParams } from './settlements';
import type { SupplyParams } from './supply';
import type { TransportRequestListParams } from './transport';

type Params = object;

/** Drops null/undefined entries so `{ status: undefined }` and `{}` share a cache entry. */
function clean<P extends Params>(params?: P): Partial<P> {
  const out: Partial<P> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params) as [keyof P, P[keyof P]][]) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

export const keys = {
  auth: {
    all: ['auth'] as const,
    me: () => ['auth', 'me'] as const,
  },
  crops: {
    all: ['crops'] as const,
    list: () => ['crops', 'list'] as const,
  },
  market: {
    all: ['market'] as const,
    prices: (params?: MarketPriceParams) => ['market', 'prices', clean(params)] as const,
  },
  harvests: {
    all: ['harvests'] as const,
    lists: () => ['harvests', 'list'] as const,
    list: (params?: HarvestListParams) => ['harvests', 'list', clean(params)] as const,
    detail: (id: UUID) => ['harvests', 'detail', id] as const,
    options: (id: UUID) => ['harvests', 'detail', id, 'options'] as const,
    timeline: (id: UUID) => ['harvests', 'detail', id, 'timeline'] as const,
  },
  demands: {
    all: ['demands'] as const,
    lists: () => ['demands', 'list'] as const,
    list: (params?: DemandListParams) => ['demands', 'list', clean(params)] as const,
    detail: (id: UUID) => ['demands', 'detail', id] as const,
  },
  supply: {
    all: ['supply'] as const,
    list: (params?: SupplyParams) => ['supply', 'list', clean(params)] as const,
  },
  calculator: {
    all: ['calculator'] as const,
  },
  lots: {
    all: ['lots'] as const,
    lists: () => ['lots', 'list'] as const,
    list: (params?: LotListParams) => ['lots', 'list', clean(params)] as const,
    detail: (id: UUID) => ['lots', 'detail', id] as const,
    timeline: (id: UUID) => ['lots', 'detail', id, 'timeline'] as const,
    transportPlan: (id: UUID) => ['lots', 'detail', id, 'transport-plan'] as const,
    delivery: (id: UUID) => ['lots', 'detail', id, 'delivery'] as const,
  },
  offers: {
    all: ['offers'] as const,
    lists: () => ['offers', 'list'] as const,
    list: (params?: OfferListParams) => ['offers', 'list', clean(params)] as const,
    detail: (id: UUID) => ['offers', 'detail', id] as const,
    breakdown: (id: UUID, params?: OfferBreakdownParams) => ['offers', 'detail', id, 'breakdown', clean(params)] as const,
  },
  transport: {
    all: ['transport'] as const,
    vehicles: () => ['transport', 'vehicles'] as const,
    requests: () => ['transport', 'requests'] as const,
    requestList: (params?: TransportRequestListParams) => ['transport', 'requests', 'list', clean(params)] as const,
    request: (id: UUID) => ['transport', 'requests', 'detail', id] as const,
  },
  settlements: {
    all: ['settlements'] as const,
    lists: () => ['settlements', 'list'] as const,
    list: (params?: SettlementListParams) => ['settlements', 'list', clean(params)] as const,
    detail: (id: UUID) => ['settlements', 'detail', id] as const,
  },
  disputes: {
    all: ['disputes'] as const,
    lists: () => ['disputes', 'list'] as const,
    list: (params?: DisputeListParams) => ['disputes', 'list', clean(params)] as const,
  },
  dashboards: {
    all: ['dashboard'] as const,
    farmer: () => ['dashboard', 'farmer'] as const,
    buyer: () => ['dashboard', 'buyer'] as const,
    transporter: () => ['dashboard', 'transporter'] as const,
    coordinator: () => ['dashboard', 'coordinator'] as const,
    admin: () => ['dashboard', 'admin'] as const,
  },
  earnings: {
    all: ['earnings'] as const,
    detail: () => ['earnings', 'detail'] as const,
  },
  insights: {
    all: ['insights'] as const,
    supplyDemand: () => ['insights', 'supply-demand'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    lists: () => ['notifications', 'list'] as const,
    list: (params?: NotificationListParams) => ['notifications', 'list', clean(params)] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },
  coordinator: {
    all: ['coordinator'] as const,
    farmers: () => ['coordinator', 'farmers'] as const,
  },
  admin: {
    all: ['admin'] as const,
    users: (params?: AdminUserListParams) => ['admin', 'users', clean(params)] as const,
    auditLog: (params?: AuditLogParams) => ['admin', 'audit-log', clean(params)] as const,
  },
  ai: {
    all: ['ai'] as const,
    status: () => ['ai', 'status'] as const,
    dealAdvice: (harvestId: UUID) => ['ai', 'deal-advice', harvestId] as const,
    counterSuggestion: (offerId: UUID, params?: CounterSuggestionParams) =>
      ['ai', 'counter-suggestion', offerId, clean(params)] as const,
  },
  public: {
    all: ['public'] as const,
    stats: () => ['public', 'stats'] as const,
    health: () => ['public', 'health'] as const,
  },
} as const;
