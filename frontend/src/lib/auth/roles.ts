import type { Role } from '@/types/api';

export const ROLE_HOME: Record<Role, string> = {
  farmer: '/app/farmer',
  buyer: '/app/buyer',
  transporter: '/app/transporter',
  coordinator: '/app/coordinator',
  admin: '/app/admin',
};

/** Landing page of a role's workspace. */
export function roleHome(role: Role): string {
  return ROLE_HOME[role];
}

/** Role check used by routes and navigation. Admins pass every coordinator check. */
export function roleAllows(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role) || (role === 'admin' && allowed.includes('coordinator'));
}

/**
 * Where to go after signing in: the `next` query parameter when it is a safe in-app path,
 * otherwise the role's home.
 */
export function postLoginPath(search: string, role: Role): string {
  const next = new URLSearchParams(search).get('next');
  if (next && next.startsWith('/app') && !next.startsWith('//') && !next.includes('\\')) return next;
  return roleHome(role);
}

/** `/login?next=<current path>` for a redirect from a protected page. */
export function loginPath(next?: string): string {
  if (!next || next === '/app' || !next.startsWith('/app')) return '/login';
  return `/login?${new URLSearchParams({ next }).toString()}`;
}
