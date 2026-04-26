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
import { setBleStabilityOverrideResolver } from '@noilink/shared';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { notifyNativeClearSession, notifyNativePersistSession } from '../native/nativeBridgeClient';
import { loadBleStabilityRemoteConfig } from '../utils/bleStabilityRemoteConfig';
import {
  cleanupExpiredDismissals as cleanupRecoveryCoachingDismissals,
  clearAllDismissals as clearAllRecoveryCoachingDismissals,
} from '../utils/recoveryCoachingDismissal';
import {
  cleanupExpiredReplayedHintSeen,
  clearAllReplayedHintSeen,
} from '../utils/replayedHintSeen';

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
    // Task #98 — 앱 부트시 한 번 prefix 스캔으로 오래 방치된 회복 코칭 닫힘
    // 기억(기본 30일 초과)을 정리한다. 인증 흐름과 독립적이므로 실패해도 무시.
    cleanupRecoveryCoachingDismissals();
    // Task #134 — 결과 화면 replayed 힌트의 sessionId 기억도 같은 결로 정리.
    // LRU-by-write 만으로는 결과 화면을 자주 안 보는 사용자의 오래된 sessionId
    // 가 자리를 차지할 수 있어, 너그러운 시간 만료(기본 30일) 안전망을 둔다.
    cleanupExpiredReplayedHintSeen();
  }, [checkAuth]);

  useEffect(() => {
    const onNativeSession = () => {
      void checkAuthRef.current();
    };
    window.addEventListener('noilink-native-session', onNativeSession);
    return () => window.removeEventListener('noilink-native-session', onNativeSession);
  }, []);

  // Task #70: 사용자 컨텍스트가 바뀌면 BLE 안내 임계값 원격 설정을 다시 받아
  // 사용자별 A/B 그룹(`match.userId`)이 즉시 반영되게 한다.
  // - main.tsx 의 부트스트랩은 보통 비로그인 상태에서 한 번만 일어나므로,
  //   로그인/세션 복원 직후 한 번 더 받아 사용자별 규칙을 적용한다.
  // - 로그아웃 시에는 직전 사용자의 오버라이드가 익명 컨텍스트에 잘못
  //   적용되지 않도록 등록을 비운다.
  // - 첫 마운트(prev=null, curr=null) 에서는 main.tsx 부트스트랩과의 경합을
  //   피하기 위해 아무 것도 하지 않는다.
  // - 직전 호출의 응답이 늦게 도착해 새 컨텍스트의 오버라이드를 덮어쓰는
  //   race 를 막기 위해 단조 증가 epoch 를 함께 넘긴다.
  const prevUserIdRef = useRef<string | null>(null);
  const bleConfigEpochRef = useRef(0);
  useEffect(() => {
    const prev = prevUserIdRef.current;
    const curr = user?.id ?? null;
    if (prev === curr) return;
    prevUserIdRef.current = curr;
    bleConfigEpochRef.current += 1;
    const epoch = bleConfigEpochRef.current;
    if (curr) {
      void loadBleStabilityRemoteConfig({
        isStale: () => bleConfigEpochRef.current !== epoch,
      });
    } else if (prev) {
      setBleStabilityOverrideResolver(null);
    }
  }, [user?.id]);

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
    // Task #98 — 다음에 같은 기기에서 다른 계정으로 로그인해도 이전 사용자의
    // 회복 코칭 닫힘 기억이 남지 않도록 prefix 의 모든 키를 비운다.
    clearAllRecoveryCoachingDismissals();
    // Task #130 — 결과 화면 "이미 저장된 결과를 불러왔어요" 안내의 sessionId
    // 기준 "본 적 있음" 기억도 함께 비운다. 이전 사용자의 sessionId 가 남아 있어
    // 새 사용자가 같은 sessionId 로 진입할 가능성은 사실상 없지만(=세션 식별자는
    // 사용자별로 분리됨), 다른 계정의 데이터가 한 기기에 영속화돼 누적되는 것을
    // 막기 위한 정리 차원에서도 동일 패턴으로 비워 둔다.
    clearAllReplayedHintSeen();
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
