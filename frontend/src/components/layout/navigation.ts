import {
  BadgeCheck,
  Banknote,
  Bell,
  Boxes,
  ChartLine,
  ClipboardList,
  Combine,
  HandCoins,
  House,
  Inbox,
  LayoutDashboard,
  Package,
  Receipt,
  Route,
  Scale,
  ScrollText,
  Settings,
  Sprout,
  Store,
  Truck,
  Users,
  Wallet,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types/api';

/**
 * Role-aware navigation for the signed-in workspace, following the route map in
 * docs/ARCHITECTURE.md. Labels are `common` namespace keys with English fallbacks.
 */

export interface NavItem {
  /** Key in the `common` namespace. */
  labelKey: string;
  /** English fallback (also used when a key is missing). */
  label: string;
  to: string;
  icon: LucideIcon;
  /** Active only on the exact path (workspace homes). */
  end?: boolean;
}

export interface NavGroup {
  id: string;
  labelKey: string;
  label: string;
  items: readonly NavItem[];
}

const item = (labelKey: string, label: string, to: string, icon: LucideIcon, end = false): NavItem => ({
  labelKey,
  label,
  to,
  icon,
  end,
});

/* ── Coordinator operations (also shown to admins as the "Operations" group) ── */

const COORDINATOR_HOME = item('nav.coordinator.home', 'Operations', '/app/coordinator', LayoutDashboard, true);
const COORDINATOR_INSIGHTS = item('nav.coordinator.insights', 'Insights', '/app/coordinator/insights', ChartLine);
const COORDINATOR_SOURCING = [
  item('nav.coordinator.farmers', 'Farmers', '/app/coordinator/farmers', Users),
  item('nav.coordinator.harvests', 'Harvests', '/app/coordinator/harvests', Sprout),
  item('nav.coordinator.lotBuilder', 'Lot builder', '/app/coordinator/lot-builder', Combine),
  item('nav.coordinator.lots', 'Lots', '/app/coordinator/lots', Boxes),
];
const COORDINATOR_TRANSPORT = item('nav.coordinator.transport', 'Transport', '/app/coordinator/transport', Truck);
const COORDINATOR_SETTLEMENTS = item('nav.coordinator.settlements', 'Settlements', '/app/coordinator/settlements', Banknote);
const COORDINATOR_TRUST = [
  item('nav.coordinator.disputes', 'Disputes', '/app/coordinator/disputes', Scale),
  item('nav.coordinator.verifications', 'Verifications', '/app/coordinator/verifications', BadgeCheck),
];

const ROLE_GROUPS: Record<Role, readonly NavGroup[]> = {
  farmer: [
    {
      id: 'overview',
      labelKey: 'nav.groups.overview',
      label: 'Overview',
      items: [item('nav.farmer.home', 'Home', '/app/farmer', House, true)],
    },
    {
      id: 'selling',
      labelKey: 'nav.groups.selling',
      label: 'Selling',
      items: [
        item('nav.farmer.harvests', 'My harvests', '/app/farmer/harvests', Sprout),
        item('nav.farmer.offers', 'Offers', '/app/farmer/offers', HandCoins),
        item('nav.farmer.lots', 'Pooled lots', '/app/farmer/lots', Combine),
        item('nav.farmer.demand', 'Buyer demand', '/app/farmer/demand', Store),
      ],
    },
    {
      id: 'money',
      labelKey: 'nav.groups.money',
      label: 'Money',
      items: [
        item('nav.farmer.sales', 'Sales', '/app/farmer/sales', Receipt),
        item('nav.farmer.earnings', 'Earnings', '/app/farmer/earnings', Wallet),
      ],
    },
  ],
  buyer: [
    {
      id: 'overview',
      labelKey: 'nav.groups.overview',
      label: 'Overview',
      items: [item('nav.buyer.home', 'Overview', '/app/buyer', LayoutDashboard, true)],
    },
    {
      id: 'sourcing',
      labelKey: 'nav.groups.sourcing',
      label: 'Sourcing',
      items: [
        item('nav.buyer.demands', 'Requirements', '/app/buyer/demands', ClipboardList),
        item('nav.buyer.supply', 'Available supply', '/app/buyer/supply', Wheat),
        item('nav.buyer.offers', 'Offers', '/app/buyer/offers', HandCoins),
      ],
    },
    {
      id: 'logistics',
      labelKey: 'nav.groups.logistics',
      label: 'Logistics',
      items: [item('nav.buyer.orders', 'Orders', '/app/buyer/orders', Package)],
    },
    {
      id: 'money',
      labelKey: 'nav.groups.money',
      label: 'Money',
      items: [item('nav.buyer.payments', 'Payments', '/app/buyer/payments', Banknote)],
    },
  ],
  transporter: [
    {
      id: 'overview',
      labelKey: 'nav.groups.overview',
      label: 'Overview',
      items: [item('nav.transporter.home', 'Overview', '/app/transporter', LayoutDashboard, true)],
    },
    {
      id: 'logistics',
      labelKey: 'nav.groups.logistics',
      label: 'Logistics',
      items: [
        item('nav.transporter.requests', 'Pickup requests', '/app/transporter/requests', Inbox),
        item('nav.transporter.trips', 'Trips', '/app/transporter/trips', Route),
        item('nav.transporter.vehicles', 'Vehicles', '/app/transporter/vehicles', Truck),
      ],
    },
  ],
  coordinator: [
    {
      id: 'overview',
      labelKey: 'nav.groups.overview',
      label: 'Overview',
      items: [COORDINATOR_HOME, COORDINATOR_INSIGHTS],
    },
    { id: 'sourcing', labelKey: 'nav.groups.sourcing', label: 'Sourcing', items: COORDINATOR_SOURCING },
    {
      id: 'logistics',
      labelKey: 'nav.groups.logistics',
      label: 'Logistics',
      items: [COORDINATOR_TRANSPORT],
    },
    { id: 'money', labelKey: 'nav.groups.money', label: 'Money', items: [COORDINATOR_SETTLEMENTS] },
    { id: 'trust', labelKey: 'layout.nav.trust', label: 'Trust & safety', items: COORDINATOR_TRUST },
  ],
  admin: [
    {
      id: 'administration',
      labelKey: 'nav.groups.administration',
      label: 'Administration',
      items: [
        item('nav.admin.home', 'Admin overview', '/app/admin', LayoutDashboard, true),
        item('nav.admin.users', 'Users', '/app/admin/users', Users),
        item('nav.admin.audit', 'Audit log', '/app/admin/audit', ScrollText),
      ],
    },
    {
      id: 'operations',
      labelKey: 'nav.groups.operations',
      label: 'Operations',
      items: [
        COORDINATOR_HOME,
        ...COORDINATOR_SOURCING,
        COORDINATOR_TRANSPORT,
        COORDINATOR_SETTLEMENTS,
        ...COORDINATOR_TRUST,
        COORDINATOR_INSIGHTS,
      ],
    },
  ],
};

function accountGroup(role: Role): NavGroup {
  const items: NavItem[] = [item('nav.shared.notifications', 'Notifications', '/app/notifications', Bell)];
  // Coordinators and admins work disputes from their operations queue.
  if (role !== 'coordinator' && role !== 'admin') {
    items.push(item('nav.shared.disputes', 'Disputes', '/app/disputes', Scale));
  }
  if (role === 'buyer' || role === 'transporter') {
    items.push(item('nav.shared.verification', 'Verification', '/app/verification', BadgeCheck));
  }
  items.push(item('nav.shared.settings', 'Settings', '/app/settings', Settings));
  return { id: 'account', labelKey: 'nav.groups.account', label: 'Account', items };
}

/** Sidebar groups for a role: its workspace groups followed by the account group. */
export function navigationFor(role: Role): readonly NavGroup[] {
  return [...ROLE_GROUPS[role], accountGroup(role)];
}

/* ── Farmer bottom tab bar (< 768 px) ── */

export interface TabItem extends NavItem {
  /** Short label for the tab bar. */
  shortKey: string;
  shortLabel: string;
}

export const FARMER_TABS: readonly TabItem[] = [
  { ...item('nav.farmer.home', 'Home', '/app/farmer', House, true), shortKey: 'layout.tabs.home', shortLabel: 'Home' },
  {
    ...item('nav.farmer.harvests', 'My harvests', '/app/farmer/harvests', Sprout),
    shortKey: 'layout.tabs.harvests',
    shortLabel: 'Harvests',
  },
  { ...item('nav.farmer.offers', 'Offers', '/app/farmer/offers', HandCoins), shortKey: 'layout.tabs.offers', shortLabel: 'Offers' },
  { ...item('nav.farmer.sales', 'Sales', '/app/farmer/sales', Receipt), shortKey: 'layout.tabs.sales', shortLabel: 'Sales' },
];

export const VOICE_LISTING_PATH = '/app/farmer/harvests/new?voice=1';

/* ── Breadcrumbs ── */

/** Named sub-pages that are not in the sidebar. */
const SUB_PAGES: Record<string, { labelKey: string; label: string }> = {
  '/app/farmer/harvests/new': { labelKey: 'nav.farmer.newHarvest', label: 'List a harvest' },
  '/app/buyer/demands/new': { labelKey: 'nav.buyer.newDemand', label: 'Post a requirement' },
  '/app/buyer/offers/new': { labelKey: 'nav.buyer.newOffer', label: 'Make an offer' },
  '/app/coordinator/farmers/new': { labelKey: 'nav.coordinator.registerFarmer', label: 'Register a farmer' },
  '/app/coordinator/harvests/new': { labelKey: 'nav.coordinator.assistedListing', label: 'Assisted listing' },
  '/app/coordinator/offers': { labelKey: 'nav.buyer.offers', label: 'Offers' },
};

/** Workspace roots, used as the first crumb. */
const WORKSPACES: Record<string, { labelKey: string; label: string }> = {
  farmer: { labelKey: 'enums.role.farmer', label: 'Farmer' },
  buyer: { labelKey: 'enums.role.buyer', label: 'Buyer' },
  transporter: { labelKey: 'enums.role.transporter', label: 'Transporter' },
  coordinator: { labelKey: 'nav.groups.operations', label: 'Operations' },
  admin: { labelKey: 'nav.groups.administration', label: 'Administration' },
};

export interface Crumb {
  labelKey: string;
  label: string;
  /** Omitted for crumbs without a page of their own and for the current page. */
  to?: string;
}

/**
 * Breadcrumbs for an `/app/...` path, e.g. `/app/farmer/harvests/<id>` →
 * Farmer › My harvests › Details. Unknown deeper segments read as "Details".
 */
export function breadcrumbsFor(pathname: string, role: Role, roleHomePath: string): Crumb[] {
  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (segments[0] !== 'app') return [];

  const allItems = navigationFor(role).flatMap((group) => group.items);
  const lookup = (path: string): Pick<Crumb, 'labelKey' | 'label'> | undefined =>
    allItems.find((entry) => entry.to === path) ?? SUB_PAGES[path];

  const crumbs: Crumb[] = [];
  const workspace = segments[1] ? WORKSPACES[segments[1]] : undefined;
  let start = 2;
  if (workspace) {
    crumbs.push({ ...workspace, to: `/app/${segments[1]}` });
  } else {
    const home = WORKSPACES[role];
    crumbs.push({ ...home, to: roleHomePath });
    start = 1;
  }

  for (let index = start; index < segments.length; index += 1) {
    const path = `/${segments.slice(0, index + 1).join('/')}`;
    const known = lookup(path);
    if (known) {
      const isNavItem = allItems.some((entry) => entry.to === path);
      crumbs.push({ ...known, to: isNavItem ? path : undefined });
    } else {
      crumbs.push({ labelKey: 'layout.breadcrumb.details', label: 'Details' });
      break;
    }
  }

  const last = crumbs[crumbs.length - 1];
  if (last) last.to = undefined;
  return crumbs;
}
