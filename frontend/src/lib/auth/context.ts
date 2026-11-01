import { createContext, useContext } from 'react';

import type { LoginRequest, SignupRequest, User } from '@/types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  /**
   * `false` until the session has been checked with the API at least once. Pages hydrated from
   * prerendered HTML start `anonymous` with `sessionChecked: false` and check in the background.
   */
  sessionChecked: boolean;
  login(req: LoginRequest): Promise<User>;
  signup(req: SignupRequest): Promise<User>;
  logout(): Promise<void>;
  /** Re-reads the signed-in user from the API (renewing the session cookie when needed). */
  refresh(): Promise<void>;
  /** Replace the cached user, e.g. after `usersApi.updateMe`. */
  setUser(user: User): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside <AuthProvider>');
  return value;
}
