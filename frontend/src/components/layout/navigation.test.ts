import { describe, expect, it } from 'vitest';
import { breadcrumbsFor, FARMER_TABS, navigationFor } from './navigation';

const labels = (role: Parameters<typeof navigationFor>[0]) =>
  navigationFor(role).flatMap((group) => group.items.map((entry) => entry.to));

describe('navigationFor', () => {
  it('gives farmers their workspace plus shared disputes, without verification', () => {
    const paths = labels('farmer');
    expect(paths).toContain('/app/farmer/harvests');
    expect(paths).toContain('/app/disputes');
    expect(paths).not.toContain('/app/verification');
  });

  it('offers verification to buyers and transporters only', () => {
    expect(labels('buyer')).toContain('/app/verification');
    expect(labels('transporter')).toContain('/app/verification');
    expect(labels('coordinator')).not.toContain('/app/verification');
  });

  it('shows admins an Administration and an Operations group', () => {
    const groups = navigationFor('admin');
    expect(groups.map((group) => group.id)).toEqual(['administration', 'operations', 'account']);
    const operations = groups.find((group) => group.id === 'operations');
    expect(operations?.items.map((entry) => entry.to)).toContain('/app/coordinator/lot-builder');
    expect(labels('admin')).not.toContain('/app/disputes');
  });

  it('only links into the signed-in workspace and marks homes as exact matches', () => {
    for (const role of ['farmer', 'buyer', 'transporter', 'coordinator', 'admin'] as const) {
      for (const group of navigationFor(role)) {
        for (const entry of group.items) {
          expect(entry.to.startsWith('/app/')).toBe(true);
          if (entry.to === `/app/${role}`) expect(entry.end).toBe(true);
        }
      }
    }
    expect(FARMER_TABS.map((tab) => tab.to)).toEqual(['/app/farmer', '/app/farmer/harvests', '/app/farmer/offers', '/app/farmer/sales']);
  });
});

describe('breadcrumbsFor', () => {
  const crumbs = (path: string, role: Parameters<typeof navigationFor>[0] = 'farmer') =>
    breadcrumbsFor(path, role, `/app/${role}`).map(({ label, to }) => ({ label, to }));

  it('labels detail pages and links ancestors', () => {
    expect(crumbs('/app/farmer/harvests/7f1c')).toEqual([
      { label: 'Farmer', to: '/app/farmer' },
      { label: 'My harvests', to: '/app/farmer/harvests' },
      { label: 'Details', to: undefined },
    ]);
  });

  it('names creation pages', () => {
    expect(crumbs('/app/farmer/harvests/new').at(-1)).toEqual({ label: 'List a harvest', to: undefined });
    expect(crumbs('/app/coordinator/farmers/new', 'coordinator').at(-1)?.label).toBe('Register a farmer');
  });

  it('roots shared pages in the user’s own workspace', () => {
    expect(crumbs('/app/notifications', 'buyer')).toEqual([
      { label: 'Buyer', to: '/app/buyer' },
      { label: 'Notifications', to: undefined },
    ]);
  });

  it('roots coordinator pages opened by an admin in Operations', () => {
    expect(crumbs('/app/coordinator/offers/91ab', 'admin')).toEqual([
      { label: 'Operations', to: '/app/coordinator' },
      { label: 'Offers', to: undefined },
      { label: 'Details', to: undefined },
    ]);
  });

  it('ignores paths outside the workspace', () => {
    expect(breadcrumbsFor('/pricing', 'farmer', '/app/farmer')).toEqual([]);
  });
});
