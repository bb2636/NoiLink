import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_BASE_URL } from '../config';
import { clearStoredAuth, getStoredToken, getStoredUserDisplay, setStoredAuth } from '../auth/storage';
import type { User } from '@noilink/shared';

type AuthContextValue = {
  ready: boolean;
  token: string | null;
  userId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshFromStorage: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const refreshFromStorage = useCallback(async () => {
    const t = await getStoredToken();
    const { userId: uid, name } = await getStoredUserDisplay();
    setToken(t);
    setUserId(uid);
    setDisplayName(name);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshFromStorage();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshFromStorage]);

  const login = useCallback(async (email: string, password: string) => {
    if (!API_BASE_URL) {
      return { ok: false, error: 'EXPO_PUBLIC_API_URL 미설정' };
    }
    try {
      const res = await fetch(`${API_BASE_URL}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        return { ok: false, error: json.error || '로그인 실패' };
      }
      const data = json.data as User | undefined;
      const tok = json.token as string | undefined;
      if (!data?.id || !tok) {
        return { ok: false, error: '응답 형식 오류' };
      }
      const name = data.name || data.username || email.trim();
      await setStoredAuth(tok, data.id, name);
      setToken(tok);
      setUserId(data.id);
      setDisplayName(name);
      return { ok: true };
    } catch {
      return { ok: false, error: '네트워크 오류' };
    }
  }, []);

  const logout = useCallback(async () => {
    await clearStoredAuth();
    setToken(null);
    setUserId(null);
    setDisplayName(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      token,
      userId,
      displayName,
      isAuthenticated: Boolean(token && userId),
      login,
      logout,
      refreshFromStorage,
    }),
    [ready, token, userId, displayName, login, logout, refreshFromStorage]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
