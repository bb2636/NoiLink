import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { STORAGE_KEYS } from '../utils/constants';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { notifyNativePersistSession } from '../native/nativeBridgeClient';

/**
 * 소셜 로그인 콜백 완료 페이지.
 *
 *   /login/social/complete#token=<jwt>&userId=<id>&username=<name>
 *
 * 서버(`/auth/naver/callback`) 가 hash fragment 로 토큰을 전달한다 — query string
 * 으로 두면 액세스 로그/리퍼러에 토큰이 노출되어 위험하므로 hash 를 쓴다.
 * 이 페이지는 토큰을 localStorage 에 저장 → useAuth.refreshUser() 로 사용자 컨텍스트
 * 를 갱신 → 홈으로 이동한다.
 */
export default function SocialLoginComplete() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const userId = params.get('userId');
    const username = params.get('username');

    if (!token || !userId) {
      setError('소셜 로그인 토큰을 받지 못했습니다.');
      const t = setTimeout(() => navigate('/login', { replace: true }), 1500);
      return () => clearTimeout(t);
    }

    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.USER_ID, userId);
    if (username) localStorage.setItem(STORAGE_KEYS.USERNAME, username);

    if (isNoiLinkNativeShell()) {
      notifyNativePersistSession(token, userId, username || '');
    }

    // hash 비우기 (뒤로가기 시 토큰 노출 방지)
    window.history.replaceState(null, '', '/login/social/complete');

    void refreshUser().finally(() => {
      navigate('/', { replace: true });
    });
  }, [navigate, refreshUser]);

  return (
    <div
      className="min-h-screen flex items-center justify-center text-white"
      style={{ backgroundColor: '#0A0A0A' }}
    >
      {error ? (
        <div className="text-red-400 text-sm text-center px-6">{error}</div>
      ) : (
        <div className="text-sm">로그인 처리 중...</div>
      )}
    </div>
  );
}
