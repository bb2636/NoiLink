import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';

/**
 * 프로필 수정 페이지
 * 1단계: 이메일/비밀번호 확인
 * 2단계: 프로필 수정 폼
 */
export default function EditProfile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'verify' | 'edit'>('verify');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // 확인 단계
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // 수정 단계
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    nickname: user?.nickname || user?.username || '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // user가 변경되면 닉네임 초기값 업데이트
  useEffect(() => {
    if (user && step === 'edit') {
      setFormData(prev => ({
        ...prev,
        nickname: user.nickname || user.username || '',
      }));
    }
  }, [user, step]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-center">
          <p className="text-gray-400 mb-4">로그인이 필요합니다.</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 rounded-lg text-white"
            style={{ backgroundColor: '#AAED10', color: '#000000' }}
          >
            로그인
          </button>
        </div>
      </div>
    );
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.login(verifyEmail, verifyPassword);
      
      if (response.success) {
        setStep('edit');
      } else {
        setError('① 이메일 또는 비밀번호가 일치하지 않습니다.');
      }
    } catch (err) {
      setError('① 이메일 또는 비밀번호가 일치하지 않습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (formData.currentPassword && formData.newPassword) {
      if (formData.newPassword.length < 8 || formData.newPassword.length > 16) {
        newErrors.newPassword = '비밀번호는 8~16자여야 합니다';
      } else if (!/^(?=.*[a-zA-Z])(?=.*\d)/.test(formData.newPassword)) {
        newErrors.newPassword = '영문과 숫자를 포함해야 합니다';
      }
      
      if (formData.newPassword !== formData.confirmPassword) {
        newErrors.confirmPassword = '비밀번호가 일치하지 않습니다';
      }
    }

    // 닉네임이 변경된 경우에만 검증
    if (formData.nickname && formData.nickname !== (user?.nickname || user?.username || '')) {
      if (formData.nickname.length < 2) {
        newErrors.nickname = '닉네임은 2자 이상이어야 합니다';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const hasChanges = () => {
    const hasPasswordChange = formData.currentPassword || formData.newPassword || formData.confirmPassword;
    const hasNicknameChange = formData.nickname !== (user?.nickname || user?.username || '');
    return hasPasswordChange || hasNicknameChange;
  };

  const isFormValid = () => {
    if (!hasChanges()) return false;
    
    const hasPasswordChange = formData.currentPassword && formData.newPassword && formData.confirmPassword;
    const hasNicknameChange = formData.nickname !== (user?.nickname || user?.username || '');
    
    if (!hasPasswordChange && !hasNicknameChange) return false;
    if (hasPasswordChange && !validateForm()) return false;
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setLoading(true);
    setError('');

    try {
      const updateData: {
        username?: string;
        currentPassword?: string;
        newPassword?: string;
      } = {};

      if (formData.nickname !== (user.nickname || user.username)) {
        updateData.username = formData.nickname;
      }

      if (formData.currentPassword && formData.newPassword) {
        updateData.currentPassword = formData.currentPassword;
        updateData.newPassword = formData.newPassword;
      }

      const response = await api.updateProfile(updateData);
      
      if (response.success) {
        // 성공 상태를 URL state로 전달하여 마이페이지로 이동
        navigate('/profile', { state: { profileUpdated: true } });
      } else {
        const errorMessage = response.error || '프로필 수정에 실패했습니다.';
        setError(errorMessage);
        
        // 인증 에러인 경우 로그인 페이지로 리다이렉트
        if (errorMessage.includes('Authentication') || errorMessage.includes('401')) {
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '프로필 수정에 실패했습니다.';
      setError(errorMessage);
      
      // 인증 에러인 경우 로그인 페이지로 리다이렉트
      if (errorMessage.includes('Authentication') || errorMessage.includes('401')) {
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="max-w-md mx-auto px-4 pt-3" style={{ paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom))' }}>
        {/* 헤더 */}
        <div className="flex items-center mb-8 relative">
          <button
            onClick={() => navigate('/profile')}
            className="text-white hover:text-gray-300 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-white absolute left-1/2 transform -translate-x-1/2">프로필 수정</h1>
        </div>

        <AnimatePresence mode="wait">
          {step === 'verify' ? (
            <motion.div
              key="verify"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="text-lg font-semibold text-white mb-2">
                안전한 수정을 위한 확인
              </h2>
              <p className="text-sm text-gray-400 mb-6">
                프로필 수정을 위해 이메일과 비밀번호를 입력해 주세요.
              </p>

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label htmlFor="verifyEmail" className="block text-sm font-medium text-white mb-2">
                    이메일
                  </label>
                  <input
                    id="verifyEmail"
                    type="email"
                    value={verifyEmail}
                    onChange={(e) => setVerifyEmail(e.target.value)}
                    placeholder="이메일 주소를 입력해 주세요."
                    required
                    className="w-full px-4 py-3 rounded-lg text-white placeholder-gray-500 outline-none"
                    style={{ backgroundColor: '#373C39', borderColor: '#4B5563' }}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label htmlFor="verifyPassword" className="block text-sm font-medium text-white mb-2">
                    비밀번호
                  </label>
                  <div className="relative">
                    <input
                      id="verifyPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={verifyPassword}
                      onChange={(e) => setVerifyPassword(e.target.value)}
                      placeholder="비밀번호를 입력해 주세요."
                      required
                      className="w-full px-4 py-3 pr-12 rounded-lg text-white placeholder-gray-500 outline-none"
                      style={{ backgroundColor: '#373C39', borderColor: '#4B5563' }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
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

                {error && (
                  <div className="flex items-start gap-2 text-red-400 text-sm">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!verifyEmail || !verifyPassword || loading}
                  className="w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: verifyEmail && verifyPassword ? '#AAED10' : '#373C39',
                    color: verifyEmail && verifyPassword ? '#000000' : '#B6B6B9'
                  }}
                >
                  {loading ? '확인 중...' : '다음'}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="edit"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <form id="edit-profile-form" onSubmit={handleSubmit} className="space-y-0">
                {/* 읽기 전용 정보 */}
                <div className="space-y-0">
                  <div className="flex items-center justify-between py-3">
                    <label className="text-sm font-medium text-white">이메일</label>
                    <div className="text-sm" style={{ color: '#B6B6B9' }}>
                      {user.email || '이메일 없음'}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between py-3">
                    <label className="text-sm font-medium text-white">이름</label>
                    <div className="text-sm" style={{ color: '#B6B6B9' }}>
                      {user.name}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between py-3">
                    <label className="text-sm font-medium text-white">휴대폰 번호</label>
                    <div className="text-sm" style={{ color: '#B6B6B9' }}>
                      {user.phone ? user.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : '010-0000-0000'}
                    </div>
                  </div>
                </div>
                
                {/* 구분선 */}
                <div className="border-b" style={{ borderColor: '#2A2A2A', borderWidth: '2px' }}></div>

                {/* 비밀번호 변경 - 구분선과 여백 추가 */}
                <div className="space-y-5" style={{ marginTop: '24px' }}>
                  <div>
                    <label htmlFor="currentPassword" className="block text-sm font-medium text-white mb-2">
                      현재 비밀번호
                    </label>
                    <div className="relative">
                      <input
                        id="currentPassword"
                        name="currentPassword"
                        type={showPasswords.current ? 'text' : 'password'}
                        value={formData.currentPassword}
                        onChange={handleChange}
                        placeholder="현재 비밀번호를 입력해 주세요."
                        className="w-full px-4 py-3 pr-12 rounded-lg text-white placeholder-gray-500 outline-none"
                        style={{ backgroundColor: '#373C39', borderColor: '#4B5563' }}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                        className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        {showPasswords.current ? (
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

                  <div>
                    <label htmlFor="newPassword" className="block text-sm font-medium text-white mb-2">
                      새 비밀번호
                    </label>
                    <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: '#373C39', borderColor: '#4B5563' }}>
                      <div className="relative">
                        <input
                          id="newPassword"
                          name="newPassword"
                          type={showPasswords.new ? 'text' : 'password'}
                          value={formData.newPassword}
                          onChange={handleChange}
                          placeholder="영문과 숫자를 포함하여 8~16자로 입력해 주세요."
                          className="w-full px-4 py-3 pr-12 rounded-none border-b text-white placeholder-gray-500 outline-none"
                          style={{ 
                            backgroundColor: 'transparent', 
                            borderColor: errors.newPassword ? '#ef4444' : '#4B5563' 
                          }}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                          className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                        >
                          {showPasswords.new ? (
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
                      <div className="relative">
                        <label htmlFor="confirmPassword" className="sr-only">비밀번호 확인</label>
                        <input
                          id="confirmPassword"
                          name="confirmPassword"
                          type={showPasswords.confirm ? 'text' : 'password'}
                          value={formData.confirmPassword}
                          onChange={handleChange}
                          placeholder="비밀번호 확인"
                          className="w-full px-4 py-3 pr-12 rounded-none text-white placeholder-gray-500 outline-none"
                          style={{ 
                            backgroundColor: 'transparent', 
                            borderColor: errors.confirmPassword ? '#ef4444' : 'transparent' 
                          }}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                          className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                        >
                          {showPasswords.confirm ? (
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
                    {errors.newPassword && (
                      <p className="mt-1 text-sm text-red-400">{errors.newPassword}</p>
                    )}
                    {errors.confirmPassword && (
                      <p className="mt-1 text-sm text-red-400">{errors.confirmPassword}</p>
                    )}
                  </div>
                </div>

                {/* 닉네임 - 새 비밀번호와 여백 추가 */}
                <div style={{ marginTop: '24px' }}>
                  <label htmlFor="nickname" className="block text-sm font-medium text-white mb-2">
                    닉네임
                  </label>
                  <input
                    id="nickname"
                    name="nickname"
                    type="text"
                    value={formData.nickname}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg text-white placeholder-gray-500 outline-none"
                    style={{ 
                      backgroundColor: '#373C39', 
                      borderColor: errors.nickname ? '#ef4444' : '#4B5563' 
                    }}
                    autoComplete="off"
                  />
                  {errors.nickname && (
                    <p className="mt-1 text-sm text-red-400">{errors.nickname}</p>
                  )}
                </div>

                {error && (
                  <div className="text-red-400 text-sm mt-4">{error}</div>
                )}
              </form>
              
              {/* 수정하기 버튼 - 고정 위치 */}
              <div 
                className="fixed bottom-0 left-0 right-0 max-w-md mx-auto px-4 z-40" 
                style={{ 
                  bottom: 'calc(4rem + env(safe-area-inset-bottom))',
                  paddingBottom: '1rem'
                }}
              >
                <button
                  type="submit"
                  form="edit-profile-form"
                  disabled={!isFormValid() || loading}
                  className="w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: isFormValid() && hasChanges() ? '#AAED10' : '#373C39',
                    color: isFormValid() && hasChanges() ? '#000000' : '#B6B6B9'
                  }}
                >
                  {loading ? '수정 중...' : '수정하기'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}