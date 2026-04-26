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
  clearLegacyReplayedHintSeenKey,
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

  // Task #142 — 부트 useEffect 는 마운트당 정확히 한 번만 돌아야 한다.
  // 과거에는 deps 에 `checkAuth` 를 두었는데, `checkAuth = useCallback(fn, [navigate])`
  // 이고 react-router 의 `useNavigate()` 는 위치 변경 후 새 참조를 돌려주는
  // 구간이 있어 같은 마운트 안에서도 `checkAuth` 가 다시 만들어져 effect 가
  // 한 번 더 돌았다. 결과적으로:
  //   - `api.getMe()` 가 콜드 스타트마다 두 번 불려 서버 트래픽이 낭비되고,
  //   - `cleanupExpiredDismissals` / `cleanupExpiredReplayedHintSeen` /
  //     `clearLegacyReplayedHintSeenKey` 의 localStorage 스캔/제거도 두 번
  //     도는(기능 영향은 없으나) 비용이 발생했다.
  // 호출은 ref 로 우회해 항상 최신 `checkAuth` 를 부르되, 트리거는 마운트 1회로
  // 잠근다(다른 화면에서 인증 재확인이 필요하면 별도 트리거가 이미 존재한다).
  useEffect(() => {
    void checkAuthRef.current();
    // Task #98 — 앱 부트시 한 번 prefix 스캔으로 오래 방치된 회복 코칭 닫힘
    // 기억(기본 30일 초과)을 정리한다. 인증 흐름과 독립적이므로 실패해도 무시.
    cleanupRecoveryCoachingDismissals();
    // Task #134 — 결과 화면 replayed 힌트의 sessionId 기억도 같은 결로 정리.
    // LRU-by-write 만으로는 결과 화면을 자주 안 보는 사용자의 오래된 sessionId
    // 가 자리를 차지할 수 있어, 너그러운 시간 만료(기본 30일) 안전망을 둔다.
    cleanupExpiredReplayedHintSeen();
    // Task #140 — 구버전(Task #118/#130)에서 쓰던 단일 키
    // (`noilink:replayed-hint-seen`)는 새 코드가 더 이상 읽지 않지만 그 시절을
    // 거친 사용자 기기에는 죽은 데이터로 남는다. 부트 시 한 번 안전하게 제거.
    clearLegacyReplayedHintSeenKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Task #133 — 결과 화면 "이미 저장된 결과를 불러왔어요" 안내의 "본 적 있음"
    // 기억은 사용자별 prefix 키(`noilink:replayed-hint-seen:<userId>`)로 분리되어
    // 저장된다. 다른 계정으로 로그인해도 그 사용자의 (빈) 키만 보이므로 안내가
    // 1회 정상 노출되고, 같은 계정으로 다시 로그인하면 자기 키가 살아 있어
    // 직전에 본 sessionId 의 안내가 다시 뜨지 않는다. 따라서 로그아웃 시
    // 강제로 비우지 않는다(이전 Task #130 의 한 번에 비우기 동작은 의도적으로
    // 제거됨).
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
