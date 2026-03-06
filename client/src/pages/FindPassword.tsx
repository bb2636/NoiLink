import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

/**
 * 비밀번호 찾기 페이지
 * 1단계: 휴대폰 번호 인증
 * 2단계: 비밀번호 재설정
 * 3단계: 완료 화면 (로티)
 */
export default function FindPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'verify' | 'reset' | 'complete'>('verify');
  const [phone, setPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [verificationCodeSent, setVerificationCodeSent] = useState(false);
  const [devVerificationCode, setDevVerificationCode] = useState('');
  const [isVerified, setIsVerified] = useState(false);

  // 휴대폰 번호 포맷팅
  const formatPhoneNumber = (value: string) => {
    const numbers = value.replace(/[^0-9]/g, '');
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
  };

  // 인증번호 전송
  const handleSendVerification = async () => {
    const phoneNumbers = phone.replace(/[^0-9]/g, '');
    
    if (!phoneNumbers || phoneNumbers.length !== 11 || !/^010/.test(phoneNumbers)) {
      setErrors({ phone: '올바른 휴대폰 번호를 입력해주세요' });
      return;
    }

    try {
      setLoading(true);
      // 서버에서 해당 휴대폰 번호로 가입된 사용자 확인
      const response = await api.findUserByPhone(phoneNumbers);
      
      if (response.success && response.data) {
        // 개발용: 6자리 랜덤 인증번호 생성
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        setDevVerificationCode(code);
        setVerificationCodeSent(true);
        console.log('인증번호 전송:', code);
        // TODO: 실제 인증번호 전송 로직
      } else {
        setErrors({ phone: '등록되지 않은 휴대폰 번호입니다' });
      }
    } catch (error) {
      setErrors({ phone: '인증번호 전송에 실패했습니다' });
    } finally {
      setLoading(false);
    }
  };

  // 인증번호 확인
  const handleVerify = () => {
    if (verificationCode === devVerificationCode) {
      setIsVerified(true);
      setErrors({});
    } else {
      setIsVerified(false);
      setErrors({ verificationCode: '인증번호가 일치하지 않습니다' });
    }
  };

  // 비밀번호 재설정
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // 검증
    if (!password.trim()) {
      setErrors({ password: '비밀번호를 입력해주세요' });
      return;
    }
    if (password.length < 8 || password.length > 16) {
      setErrors({ password: '비밀번호는 8~16자여야 합니다' });
      return;
    }
    if (!/^(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) {
      setErrors({ password: '영문과 숫자를 포함해야 합니다' });
      return;
    }
    if (password !== passwordConfirm) {
      setErrors({ passwordConfirm: '비밀번호가 일치하지 않습니다' });
      return;
    }

    try {
      setLoading(true);
      const phoneNumbers = phone.replace(/[^0-9]/g, '');
      const response = await api.resetPassword(phoneNumbers, password);

      if (response.success) {
        setStep('complete');
      } else {
        setErrors({ submit: response.error || '비밀번호 재설정에 실패했습니다' });
      }
    } catch (error) {
      setErrors({ submit: '비밀번호 재설정에 실패했습니다' });
    } finally {
      setLoading(false);
    }
  };

  // 휴대폰 번호 변경 핸들러
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
    if (errors.phone) {
      setErrors({ ...errors, phone: '' });
    }
  };

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-md mx-auto w-full">
        {/* 헤더 */}
        <div className="flex items-center mb-8">
          <button
            onClick={() => navigate(-1)}
            className="mr-4 text-white hover:opacity-80 transition-opacity"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold">
            {step === 'verify' && '비밀번호 찾기'}
            {step === 'reset' && '비밀번호 재설정'}
            {step === 'complete' && '비밀번호 재설정'}
          </h1>
        </div>

        <AnimatePresence mode="wait">
          {/* 1단계: 휴대폰 번호 인증 */}
          {step === 'verify' && (
            <motion.div
              key="verify"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h2 className="text-white text-lg font-semibold mb-4">휴대폰 번호 인증</h2>
              
              {/* 휴대폰 번호 입력 */}
              <div className="mb-4">
                <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#373C39', border: '1px solid #4B5563' }}>
                  {/* 첫 번째 행: 휴대폰 번호 입력 + 인증번호 전송 */}
                  <div className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: '#4B5563' }}>
                    <input
                      type="text"
                      value={phone}
                      onChange={handlePhoneChange}
                      placeholder="휴대폰 번호"
                      maxLength={13}
                      className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none"
                      style={{ color: phone ? '#ffffff' : '#B6B6B9' }}
                    />
                    <button
                      type="button"
                      onClick={handleSendVerification}
                      disabled={loading}
                      className="px-5 py-2.5 font-semibold transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ 
                        backgroundColor: '#AAED10',
                        color: '#000000',
                        borderRadius: '9999px'
                      }}
                    >
                      인증번호 전송
                    </button>
                  </div>
                  {/* 두 번째 행: 인증번호 입력 + 인증하기 */}
                  <div className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="text"
                      value={verificationCode}
                      onChange={(e) => {
                        setVerificationCode(e.target.value);
                        if (errors.verificationCode) {
                          setErrors({ ...errors, verificationCode: '' });
                        }
                      }}
                      placeholder="인증번호"
                      maxLength={6}
                      disabled={!verificationCodeSent || isVerified}
                      className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none"
                      style={{ color: verificationCode ? '#ffffff' : '#B6B6B9' }}
                    />
                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={isVerified || !verificationCodeSent || !verificationCode || verificationCode.length !== 6}
                      className="px-5 py-2.5 font-semibold transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ 
                        backgroundColor: '#373C39',
                        color: isVerified ? '#ffffff' : ((!verificationCodeSent || !verificationCode || verificationCode.length !== 6) ? '#B6B6B9' : '#ffffff'),
                        borderRadius: '9999px'
                      }}
                    >
                      {isVerified ? '인증완료' : '인증하기'}
                    </button>
                  </div>
                </div>
                
                {/* 개발용 인증번호 표시 */}
                {verificationCodeSent && devVerificationCode && (
                  <div className="mt-2 text-sm" style={{ color: '#AAED10' }}>
                    개발용 인증번호: [{devVerificationCode}]
                  </div>
                )}

                {/* 인증 완료 메시지 */}
                <AnimatePresence>
                  {isVerified && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="mt-4 flex items-center gap-2"
                    >
                      <svg className="w-5 h-5 text-lime-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <p className="text-sm text-lime-500">인증이 완료되었습니다.</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 에러 메시지 */}
                {errors.phone && (
                  <div className="mt-2 text-sm text-red-400">{errors.phone}</div>
                )}
                {errors.verificationCode && (
                  <div className="mt-2 text-sm text-red-400">{errors.verificationCode}</div>
                )}
              </div>

              {/* 다음 버튼 */}
              <button
                onClick={() => {
                  if (isVerified) {
                    setStep('reset');
                  }
                }}
                disabled={!isVerified}
                className="w-full py-4 rounded-3xl font-semibold transition-all fixed left-0 right-0 max-w-md mx-auto"
                style={{
                  backgroundColor: isVerified ? '#373C39' : '#1A1A1A',
                  color: isVerified ? '#ffffff' : '#B6B6B9',
                  bottom: `calc(5rem + env(safe-area-inset-bottom))`,
                }}
              >
                다음
              </button>
            </motion.div>
          )}

          {/* 2단계: 비밀번호 재설정 */}
          {step === 'reset' && (
            <motion.div
              key="reset"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h2 className="text-white text-lg font-semibold mb-4">비밀번호 입력</h2>
              
              <form onSubmit={handleResetPassword}>
                {/* 비밀번호 입력 필드 통합 박스 */}
                <div className="border border-gray-700 rounded-2xl overflow-hidden mb-4" style={{ backgroundColor: '#373C39' }}>
                  <div className="px-4 py-3 border-b border-gray-700">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) {
                          setErrors({ ...errors, password: '' });
                        }
                      }}
                      placeholder="영문과 숫자를 포함하여 8~16자로 입력해 주세요."
                      className="w-full bg-transparent text-white focus:outline-none"
                      style={{ color: password ? '#ffffff' : '#B6B6B9' }}
                    />
                  </div>
                  <div className="px-4 py-3 relative">
                    <input
                      type={showPasswordConfirm ? 'text' : 'password'}
                      value={passwordConfirm}
                      onChange={(e) => {
                        setPasswordConfirm(e.target.value);
                        if (errors.passwordConfirm) {
                          setErrors({ ...errors, passwordConfirm: '' });
                        }
                      }}
                      placeholder="비밀번호 확인"
                      className="w-full bg-transparent text-white focus:outline-none pr-12"
                      style={{ color: passwordConfirm ? '#ffffff' : '#B6B6B9' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    >
                      {showPasswordConfirm ? (
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

                {/* 에러 메시지 */}
                <AnimatePresence>
                  {errors.password && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-red-400 text-sm mb-4"
                    >
                      {errors.password}
                    </motion.div>
                  )}
                  {errors.passwordConfirm && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-red-400 text-sm mb-4"
                    >
                      {errors.passwordConfirm}
                    </motion.div>
                  )}
                  {errors.submit && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-red-400 text-sm mb-4"
                    >
                      {errors.submit}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 다음 버튼 */}
                <button
                  type="submit"
                  disabled={loading || !password.trim() || !passwordConfirm.trim()}
                  className="w-full py-4 rounded-3xl font-semibold transition-all fixed left-0 right-0 max-w-md mx-auto"
                  style={{
                    bottom: `calc(5rem + env(safe-area-inset-bottom))`,
                    backgroundColor: loading || !password.trim() || !passwordConfirm.trim() ? '#1A1A1A' : '#373C39',
                    color: loading || !password.trim() || !passwordConfirm.trim() ? '#B6B6B9' : '#ffffff',
                  }}
                >
                  {loading ? '처리 중...' : '다음'}
                </button>
              </form>
            </motion.div>
          )}

          {/* 3단계: 완료 화면 (로티) */}
          {step === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center min-h-[60vh]"
            >
              {/* 로티 애니메이션 영역 (임시로 체크 아이콘 사용) */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                className="mb-6"
              >
                <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ backgroundColor: '#AAED10' }}>
                  <svg className="w-12 h-12 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </motion.div>

              {/* 성공 메시지 */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center mb-8"
              >
                <h2 className="text-2xl font-bold mb-2" style={{ color: '#AAED10' }}>
                  비밀번호 재설정 완료
                </h2>
                <p className="text-gray-400">
                  새로운 비밀번호로 로그인해주세요.
                </p>
              </motion.div>

              {/* 로그인 버튼 */}
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                onClick={() => navigate('/login')}
                className="w-full py-4 rounded-2xl font-bold text-white"
                style={{
                  background: 'linear-gradient(90deg, #AAED10 0%, #8BC90D 100%)',
                }}
              >
                로그인
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
