import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { authApi } from '@/lib/api/auth';
import { isApiError, onSessionExpired } from '@/lib/api/client';
import { keys } from '@/lib/api/keys';
import { readStorage, writeStorage } from '@/lib/hooks/useLocalStorage';
import { getSavedLanguage, setLanguage } from '@/lib/i18n';
import type { LoginRequest, SignupRequest, User } from '@/types/api';

import { AuthContext, type AuthContextValue, type AuthStatus } from './context';

/**
 * Non-sensitive marker that this browser signed in before. It lets public pages skip the
 * `/auth/me` round trip for visitors who never had a session. The session itself lives only in
 * httpOnly cookies.
 */
const SESSION_HINT_KEY = 'mandimate.session';

interface AuthState {
  user: User | null;
  status: AuthStatus;
  checked: boolean;
}

const isServer = typeof window === 'undefined';

function hasSessionHint(): boolean {
  return readStorage(SESSION_HINT_KEY) === '1';
}

function shouldCheckOnMount(): boolean {
  return hasSessionHint() || window.location.pathname.startsWith('/app');
}

function initialState(hydrating: boolean): AuthState {
  if (isServer) return { user: null, status: 'anonymous', checked: true };
  if (hydrating || !shouldCheckOnMount()) return { user: null, status: 'anonymous', checked: false };
  return { user: null, status: 'loading', checked: false };
}

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * `true` when hydrating prerendered HTML: the first render must match the server (`anonymous`),
   * so the session is checked in the background after mount.
   */
  hydrating?: boolean;
}

export function AuthProvider({ children, hydrating = false }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(() => initialState(hydrating));
  const userRef = useRef<User | null>(state.user);
  const checkInFlight = useRef<Promise<void> | null>(null);

  const establish = useCallback(
    (user: User) => {
      userRef.current = user;
      writeStorage(SESSION_HINT_KEY, '1');
      queryClient.setQueryData(keys.auth.me(), user);
      setState({ user, status: 'authenticated', checked: true });
    },
    [queryClient],
  );

  const clearSession = useCallback(
    ({ keepHint = false }: { keepHint?: boolean } = {}) => {
      userRef.current = null;
      if (!keepHint) writeStorage(SESSION_HINT_KEY, null);
      queryClient.removeQueries({ queryKey: keys.auth.all });
      setState({ user: null, status: 'anonymous', checked: true });
    },
    [queryClient],
  );

  const refresh = useCallback((): Promise<void> => {
    checkInFlight.current ??= (async () => {
      try {
        const user = await authApi.me();
        const firstRestore = userRef.current === null;
        establish(user);
        if (firstRestore && !getSavedLanguage()) void setLanguage(user.preferred_language);
      } catch (error) {
        if (isApiError(error) && (error.status === 401 || error.status === 403)) {
          clearSession();
        } else if (userRef.current) {
          // A network or server failure says nothing about the session: keep the signed-in user.
          setState((current) => ({ ...current, checked: true }));
        } else {
          clearSession({ keepHint: true });
        }
      } finally {
        checkInFlight.current = null;
      }
    })();
    return checkInFlight.current;
  }, [clearSession, establish]);

  const signIn = useCallback(
    (user: User) => {
      queryClient.clear();
      establish(user);
      void setLanguage(user.preferred_language);
      return user;
    },
    [establish, queryClient],
  );

  const login = useCallback(
    async (req: LoginRequest) => signIn((await authApi.login(req)).user),
    [signIn],
  );

  const signup = useCallback(
    async (req: SignupRequest) => signIn((await authApi.signup(req)).user),
    [signIn],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // 401 means the session had already ended; anything else is reported after signing out locally.
      if (!isApiError(error) || error.status !== 401) throw error;
    } finally {
      clearSession();
      queryClient.clear();
    }
  }, [clearSession, queryClient]);

  const setUser = useCallback(
    (user: User) => {
      const previous = userRef.current;
      establish(user);
      if (previous && previous.preferred_language !== user.preferred_language) {
        void setLanguage(user.preferred_language);
      }
    },
    [establish],
  );

  useEffect(() => {
    if (shouldCheckOnMount()) void refresh();
  }, [refresh]);

  useEffect(() => onSessionExpired(() => clearSession()), [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      status: state.status,
      sessionChecked: state.checked,
      login,
      signup,
      logout,
      refresh,
      setUser,
    }),
    [state, login, signup, logout, refresh, setUser],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
