import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { STORAGE_KEYS } from '../utils/constants';
import type { User } from '@noilink/shared';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { notifyNativeClearSession, notifyNativePersistSession } from '../native/nativeBridgeClient';

/**
 * 인증 상태를 앱 전역에서 공유하기 위한 컨텍스트.
 * 이전에는 각 페이지가 useAuth()를 호출할 때마다 별도 상태가 생기고
 * 그때마다 /me 를 다시 조회해 user가 잠깐 null이 되어 "로그인이 필요합니다"
 * 안내가 깜빡이는 문제가 있었음. AuthProvider로 한 번만 조회하도록 수정.
 */

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; user?: User; error?: string }>;
  signup: (userData: {
    username: string;
    email?: string;
    name?: string;
    age?: number;
    password?: string;
    phone?: string;
    userType?: 'PERSONAL' | 'ORGANIZATION';
    organizationName?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.TOKEN);

      if (!token) {
        if (
          window.location.pathname !== '/login' &&
          window.location.pathname !== '/signup' &&
          window.location.pathname !== '/find-password' &&
          window.location.pathname !== '/splash'
        ) {
          localStorage.removeItem(STORAGE_KEYS.USER_ID);
          localStorage.removeItem(STORAGE_KEYS.USERNAME);
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          const hasSeenSplash = sessionStorage.getItem('noilink_splash_seen') === 'true';
          navigate(hasSeenSplash ? '/login' : '/splash', { replace: true });
        }
        setLoading(false);
        return;
      }

      const response = await api.getMe();
      if (response.success && response.data) {
        setUser(response.data);
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER_ID);
        localStorage.removeItem(STORAGE_KEYS.USERNAME);
        localStorage.removeItem(STORAGE_KEYS.TOKEN);
        if (
          window.location.pathname !== '/login' &&
          window.location.pathname !== '/signup' &&
          window.location.pathname !== '/find-password' &&
          window.location.pathname !== '/splash'
        ) {
          const hasSeenSplash = sessionStorage.getItem('noilink_splash_seen') === 'true';
          navigate(hasSeenSplash ? '/login' : '/splash', { replace: true });
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem(STORAGE_KEYS.USER_ID);
      localStorage.removeItem(STORAGE_KEYS.USERNAME);
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      if (
        window.location.pathname !== '/login' &&
        window.location.pathname !== '/signup' &&
        window.location.pathname !== '/find-password' &&
        window.location.pathname !== '/splash'
      ) {
        const hasSeenSplash = sessionStorage.getItem('noilink_splash_seen') === 'true';
        navigate(hasSeenSplash ? '/login' : '/splash', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const checkAuthRef = useRef(checkAuth);
  checkAuthRef.current = checkAuth;

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const onNativeSession = () => {
      void checkAuthRef.current();
    };
    window.addEventListener('noilink-native-session', onNativeSession);
    return () => window.removeEventListener('noilink-native-session', onNativeSession);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await api.login(email, password);
      if (response.success && response.data) {
        const u = response.data;
        const token = response.token;
        if (!token) {
          return {
            success: false,
            error: '서버에서 인증 토큰을 받지 못했습니다. 관리자에게 문의해 주세요.',
          };
        }
        setUser(u);
        localStorage.setItem(STORAGE_KEYS.USER_ID, u.id);
        localStorage.setItem(STORAGE_KEYS.USERNAME, u.username);
        localStorage.setItem(STORAGE_KEYS.TOKEN, token);
        if (isNoiLinkNativeShell()) {
          notifyNativePersistSession(token, u.id, u.username);
        }
        return { success: true, user: u };
      }
      return { success: false, error: response.error || '이메일 또는 비밀번호가 올바르지 않습니다' };
    } catch {
      return { success: false, error: '로그인 실패' };
    }
  };

  const signup: AuthContextValue['signup'] = async (userData) => {
    try {
      const response = await api.createUser(userData);
      if (response.success && response.data) {
        const u = response.data;
        const token = response.token;
        if (userData.password && userData.email) {
          if (!token) {
            return {
              success: false,
              error: '가입은 되었으나 로그인 토큰을 받지 못했습니다. 로그인 화면에서 다시 시도해 주세요.',
            };
          }
          localStorage.setItem(STORAGE_KEYS.TOKEN, token);
          if (isNoiLinkNativeShell()) {
            notifyNativePersistSession(token, u.id, u.username);
          }
        }
        setUser(u);
        localStorage.setItem(STORAGE_KEYS.USER_ID, u.id);
        localStorage.setItem(STORAGE_KEYS.USERNAME, u.username);
        return { success: true };
      }
      return { success: false, error: response.error || '회원가입 실패' };
    } catch {
      return { success: false, error: '회원가입 실패' };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    localStorage.removeItem(STORAGE_KEYS.USERNAME);
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    if (isNoiLinkNativeShell()) {
      notifyNativeClearSession();
    }
    navigate('/login');
  };

  const refreshUser = async () => {
    try {
      const response = await api.getMe();
      if (response.success && response.data) {
        setUser(response.data);
      }
    } catch {
      /* ignore */
    }
  };

  const value: AuthContextValue = {
    user,
    loading,
    login,
    signup,
    logout,
    refreshUser,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
