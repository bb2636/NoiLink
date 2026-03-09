import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { STORAGE_KEYS } from '../utils/constants';
import type { User } from '@noilink/shared';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  useEffect(() => {
    checkAuth();
  }, []);
  
  const checkAuth = async () => {
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
  };
  
  const login = async (email: string, password: string) => {
    try {
      const response = await api.login(email, password);
      if (response.success && response.data) {
        const user = response.data;
        const token = (response as any).token;
        
        setUser(user);
        localStorage.setItem(STORAGE_KEYS.USER_ID, user.id);
        localStorage.setItem(STORAGE_KEYS.USERNAME, user.username);
        
        // JWT 토큰 저장
        if (token) {
          localStorage.setItem(STORAGE_KEYS.TOKEN, token);
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
        setUser(response.data);
        localStorage.setItem(STORAGE_KEYS.USER_ID, response.data.id);
        localStorage.setItem(STORAGE_KEYS.USERNAME, response.data.username);
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
    navigate('/login');
  };
  
  return {
    user,
    loading,
    login,
    signup,
    logout,
    isAuthenticated: !!user,
  };
}
