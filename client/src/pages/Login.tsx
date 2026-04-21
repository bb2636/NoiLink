import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { User } from '@noilink/shared';
import Logo from '../components/Logo';

/**
 * 로그인 페이지
 * 피그마 디자인 기반 구현 (다크 테마)
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    if (!email.trim()) {
      setError('이메일을 입력해주세요');
      setLoading(false);
      return;
    }
    
    if (!password.trim()) {
      setError('비밀번호를 입력해주세요');
      setLoading(false);
      return;
    }
    
    const result = await login(email, password);
    
    if (result.success) {
      // 관리자 계정인 경우 관리자 페이지로 리다이렉트
      const user = result.user as User | undefined;
      if (user?.userType === 'ADMIN') {
        navigate('/admin/users');
      } else {
        navigate('/');
      }
    } else {
      setError(result.error || '로그인에 실패했습니다');
    }
    
    setLoading(false);
  };
  
  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-md mx-auto w-full">
        {/* 로고 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <Logo size="md" white />
        </motion.div>
        
        {/* 타이틀 */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <h2 className="text-2xl font-semibold">NoiLink 로그인</h2>
        </motion.div>
        
        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} className="mb-6">
          {/* 입력 필드 통합 박스 */}
          <div className="border border-gray-700 rounded-2xl overflow-hidden mb-4" style={{ backgroundColor: '#373C39' }}>
            {/* 이메일 입력 */}
            <div className="px-4 py-3 border-b border-gray-700">
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent text-white focus:outline-none"
                style={{ color: email ? '#ffffff' : '#B6B6B9' }}
                placeholder="이메일"
                disabled={loading}
              />
            </div>
            
            {/* 비밀번호 입력 */}
            <div className="px-4 py-3">
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent text-white focus:outline-none pr-12"
                  style={{ color: password ? '#ffffff' : '#B6B6B9' }}
                  placeholder="비밀번호"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          
          {/* 에러 메시지 */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-start gap-2 text-red-400 text-sm mb-4"
              >
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>이메일 또는 비밀번호가 일치하지 않습니다.</span>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* 로그인 버튼 */}
          <button
            type="submit"
            disabled={loading || !email.trim() || !password.trim()}
            className={`w-full py-3 rounded-2xl font-semibold transition-all ${
              loading || !email.trim() || !password.trim()
                ? 'cursor-not-allowed'
                : 'hover:opacity-90 active:scale-95'
            }`}
            style={
              loading || !email.trim() || !password.trim()
                ? { backgroundColor: '#373C39', color: '#B6B6B9' }
                : { backgroundColor: '#AAED10', color: '#000000' }
            }
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
        
        {/* 비밀번호 찾기 / 회원가입 */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <Link
            to="/find-password"
            className="text-sm hover:opacity-80 transition-opacity flex items-center"
            style={{ color: '#FFFFFF' }}
          >
            비밀번호 찾기
          </Link>
          <span className="text-sm" style={{ color: '#B6B6B9' }}>|</span>
          <Link
            to="/signup"
            className="text-sm hover:opacity-80 transition-opacity flex items-center"
            style={{ color: '#FFFFFF' }}
          >
            회원가입하기
          </Link>
        </div>
        
        {/* 간편 로그인 구분선 */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" style={{ borderColor: '#B6B6B9' }}></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4" style={{ backgroundColor: '#0A0A0A', color: '#B6B6B9' }}>간편 로그인</span>
          </div>
        </div>
        
        {/* 간편 로그인 버튼들 */}
        <div className="flex justify-center gap-4">
          {/* 카카오톡 */}
          <button
            type="button"
            className="w-12 h-12 rounded-full bg-yellow-400 flex items-center justify-center hover:scale-110 transition-transform"
            onClick={() => {
              // TODO: 카카오톡 로그인 구현
              console.log('카카오톡 로그인');
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 0C4.48 0 0 3.52 0 7.87c0 2.75 1.94 5.16 4.81 6.45L3.5 20l6.19-3.35C9.95 16.65 9.98 16.66 10 16.66c5.52 0 10-3.52 10-7.87C20 3.52 15.52 0 10 0z" fill="#3C1E1E"/>
            </svg>
          </button>
          
          {/* 네이버 */}
          <button
            type="button"
            className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center hover:scale-110 transition-transform"
            onClick={() => {
              // TODO: 네이버 로그인 구현
              console.log('네이버 로그인');
            }}
          >
            <span className="text-lg font-bold text-white">N</span>
          </button>
        </div>
      </div>
    </div>
  );
}
