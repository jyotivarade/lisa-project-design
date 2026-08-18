import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { authApi } from "@/services/auth";
import { setAccessToken, setSessionLostHandler } from "@/services/client";
import type { User } from "@/types/api";

export interface AuthState {
  user: User | null;
  /** True until the initial session-restore attempt has settled. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  /** Permission codes come from the server, never inferred from the role name. */
  can: (permission: string) => boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // The access token lives in memory, so a reload starts with none. The
    // HttpOnly refresh cookie is what carries the session across a page load.
    let cancelled = false;
    authApi
      .restore()
      .then((session) => {
        if (cancelled) return;
        setAccessToken(session.access_token);
        setUser(session.user);
      })
      .catch(() => {
        if (!cancelled) setAccessToken(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // When a refresh fails mid-session, drop the user so the router shows login
    // rather than leaving a signed-in shell that cannot load anything.
    setSessionLostHandler(() => setUser(null));
    return () => setSessionLostHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await authApi.login(email, password);
    setAccessToken(session.access_token);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Always clear locally: a network failure must not leave the UI signed in.
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoading,
      signIn,
      signOut,
      setUser,
      can: (permission: string) => user?.permissions.includes(permission) ?? false,
    }),
    [user, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
