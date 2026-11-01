import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { loginPath, postLoginPath, roleAllows, roleHome, useAuth } from '@/lib/auth';
import type { Role } from '@/types/api';

import { PageLoader } from './PageLoader';

/** Renders children (or the nested route) only for a signed-in user; otherwise sends them to /login. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status, sessionChecked, refresh } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!sessionChecked) void refresh();
  }, [sessionChecked, refresh]);

  if (status === 'authenticated') return children ?? <Outlet />;
  if (status === 'loading' || !sessionChecked) return <PageLoader fullScreen />;
  return <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
}

/** Nested-route guard: users without one of `roles` go to their own home. Admins pass coordinator checks. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roleAllows(user.role, roles)) return <Navigate to={roleHome(user.role)} replace />;
  return <Outlet />;
}

/**
 * For /login and /signup: a signed-in visitor is sent on to `?next=` or their home. The server always
 * renders the page because SSR is anonymous.
 */
export function GuestOnly() {
  const { status, user } = useAuth();
  const { search } = useLocation();
  if (status === 'authenticated' && user) return <Navigate to={postLoginPath(search, user.role)} replace />;
  return <Outlet />;
}
