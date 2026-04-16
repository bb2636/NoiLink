import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { STORAGE_KEYS } from '../utils/constants';
import type { User } from '@noilink/shared';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { notifyNativeClearSession, notifyNativePersistSession } from '../native/nativeBridgeClient';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
      
      // JWT 토큰이 없으면 스플래시 노출 여부에 따라 분기
      if (!token) {
        // 로그인/가입 관련 페이지가 아닐 때만 리디렉션
        if (window.location.pathname !== '/login' && 
            window.location.pathname !== '/signup' && 
            window.location.pathname !== '/find-password' &&
            window.location.pathname !== '/splash') {
          localStorage.removeItem(STORAGE_KEYS.USER_ID);
          localStorage.removeItem(STORAGE_KEYS.USERNAME);
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          const hasSeenSplash = sessionStorage.getItem('noilink_splash_seen') === 'true';
          navigate(hasSeenSplash ? '/login' : '/splash', { replace: true });
        }
        setLoading(false);
        return;
      }
      
      // JWT 토큰이 있으면 /me 엔드포인트로 사용자 정보 조회
      const response = await api.getMe();
      if (response.success && response.data) {
        setUser(response.data);
      } else {
        // 토큰이 유효하지 않으면 로그아웃 처리
        localStorage.removeItem(STORAGE_KEYS.USER_ID);
        localStorage.removeItem(STORAGE_KEYS.USERNAME);
        localStorage.removeItem(STORAGE_KEYS.TOKEN);
        
        // 로그인 페이지가 아닐 때만 리디렉션
        if (window.location.pathname !== '/login' && 
            window.location.pathname !== '/signup' && 
            window.location.pathname !== '/find-password' &&
            window.location.pathname !== '/splash') {
          const hasSeenSplash = sessionStorage.getItem('noilink_splash_seen') === 'true';
          navigate(hasSeenSplash ? '/login' : '/splash', { replace: true });
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem(STORAGE_KEYS.USER_ID);
      localStorage.removeItem(STORAGE_KEYS.USERNAME);
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      
      // 로그인 페이지가 아닐 때만 리디렉션
      if (window.location.pathname !== '/login' && 
          window.location.pathname !== '/signup' && 
          window.location.pathname !== '/find-password' &&
          window.location.pathname !== '/splash') {
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
        const user = response.data;
        const token = response.token;

        if (!token) {
          return {
            success: false,
            error: '서버에서 인증 토큰을 받지 못했습니다. 관리자에게 문의해 주세요.',
          };
        }

        setUser(user);
        localStorage.setItem(STORAGE_KEYS.USER_ID, user.id);
        localStorage.setItem(STORAGE_KEYS.USERNAME, user.username);
        localStorage.setItem(STORAGE_KEYS.TOKEN, token);
        if (isNoiLinkNativeShell()) {
          notifyNativePersistSession(token, user.id, user.username);
        }

        return { success: true, user };
      }
      return { success: false, error: response.error || '이메일 또는 비밀번호가 올바르지 않습니다' };
    } catch (error) {
      return { success: false, error: '로그인 실패' };
    }
  };
  
  const signup = async (userData: {
    username: string;
    email?: string;
    name?: string;
    age?: number;
    password?: string;
    phone?: string;
    userType?: 'PERSONAL' | 'ORGANIZATION';
  }) => {
    try {
      const response = await api.createUser(userData);
      if (response.success && response.data) {
        const user = response.data;
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
            notifyNativePersistSession(token, user.id, user.username);
          }
        }

        setUser(user);
        localStorage.setItem(STORAGE_KEYS.USER_ID, user.id);
        localStorage.setItem(STORAGE_KEYS.USERNAME, user.username);
        return { success: true };
      }
      return { success: false, error: response.error || '회원가입 실패' };
    } catch (error) {
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
  
  return {
    user,
    loading,
    login,
    signup,
    logout,
    refreshUser,
    isAuthenticated: !!user,
  };
}
