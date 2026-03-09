import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import splashBg from '../assets/brainimals/noi_splash.png';

/**
 * 첫 접속 시 보여주는 스플래시 화면
 * - 배경: noi_splash.png
 * - 중앙: 메인 로고
 * - 로고 아래: "연결로 완성되는 솔루션"
 * - 3초 후 로그인 페이지로 이동
 */
export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    // 스플래시 노출 여부 저장 (세션 내 첫 접속 판단용 - 탭/앱 열 때마다 스플래시)
    try {
      sessionStorage.setItem('noilink_splash_seen', 'true');
    } catch {
      // localStorage 사용 불가한 환경은 무시
    }

    const timer = setTimeout(() => {
      navigate('/login', { replace: true });
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        backgroundImage: `url(${splashBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="flex flex-col items-center" style={{ gap: '16px' }}>
        <Logo size="lg" />
        <p
          className="text-sm"
          style={{ color: '#FFFFFF', marginTop: '12px' }}
        >
          연결로 완성되는 솔루션
        </p>
      </div>
    </div>
  );
}

