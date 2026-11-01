import { Navigate } from 'react-router';

import { roleHome, useAuth } from '@/lib/auth';

/** `/app` → the signed-in user's role home. */
export function AppIndexRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  return <Navigate to={roleHome(user.role)} replace />;
}
