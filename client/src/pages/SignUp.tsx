import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import TermsModal from '../components/TermsModal/TermsModal';

/**
 * 회원가입 페이지
 * 피그마 디자인 기반 구현 (다크 테마, 단계별)
 */
export default function SignUp() {
  const location = useLocation();
  const [step, setStep] = useState<'select' | 'form'>('select');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
    name: '',
    nickname: '',
    phone: '',
    verificationCode: '',
    userType: null as 'PERSONAL' | 'ORGANIZATION' | null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [agreements, setAgreements] = useState({
    all: false,
    service: false,
    privacy: false,
  });
  const [terms, setTerms] = useState<{
    service?: { id: string; title: string; content: string; version?: number; createdAt?: string; updatedAt?: string };
    privacy?: { id: string; title: string; content: string; version?: number; createdAt?: string; updatedAt?: string };
  }>({});
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [selectedTermsType, setSelectedTermsType] = useState<'SERVICE' | 'PRIVACY' | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [verificationCodeSent, setVerificationCodeSent] = useState(false);
  const [devVerificationCode, setDevVerificationCode] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { signup } = useAuth();
  const navigate = useNavigate();
  
  // 모든 상태 초기화 함수
  const resetAllStates = () => {
    setStep('select');
    setFormData({
      email: '',
      password: '',
      passwordConfirm: '',
      name: '',
      nickname: '',
      phone: '',
      verificationCode: '',
      userType: null,
    });
    setErrors({});
    setLoading(false);
    setShowPasswordConfirm(false);
    setShowTooltip(false);
    setAgreements({
      all: false,
      service: false,
      privacy: false,
    });
    setFileCount(0);
    setVerificationCodeSent(false);
    setDevVerificationCode('');
    setIsVerified(false);
  };

  // 로그인 페이지에서 회원가입 클릭 시 첫 번째 탭으로 이동
  useEffect(() => {
    if (location.pathname === '/signup') {
      setStep('select');
    }
  }, [location.pathname]);

  // 뒤로가기 시 모든 상태 초기화
  useEffect(() => {
    const handlePopState = () => {
      resetAllStates();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      // 컴포넌트 언마운트 시에도 초기화
      resetAllStates();
    };
  }, []);

  // 약관 내용 로드
  useEffect(() => {
    const loadTerms = async () => {
      try {
        const serviceRes = await api.getTermByType('SERVICE');
        const privacyRes = await api.getTermByType('PRIVACY');
        
        if (serviceRes.success && serviceRes.data) {
          setTerms(prev => ({
            ...prev,
            service: {
              id: serviceRes.data!.id,
              title: serviceRes.data!.title,
              content: serviceRes.data!.content,
              version: serviceRes.data!.version,
              createdAt: serviceRes.data!.createdAt,
              updatedAt: serviceRes.data!.updatedAt,
            },
          }));
        }
        
        if (privacyRes.success && privacyRes.data) {
          setTerms(prev => ({
            ...prev,
            privacy: {
              id: privacyRes.data!.id,
              title: privacyRes.data!.title,
              content: privacyRes.data!.content,
              version: privacyRes.data!.version,
              createdAt: privacyRes.data!.createdAt,
              updatedAt: privacyRes.data!.updatedAt,
            },
          }));
        }
      } catch (error) {
        console.error('Failed to load terms:', error);
      }
    };
    
    loadTerms();
  }, []);

  // 툴팁 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatPhoneNumber = (value: string): string => {
    // 숫자만 추출
    const numbers = value.replace(/[^0-9]/g, '');
    // 최대 11자리로 제한
    const limited = numbers.slice(0, 11);
    
    // 010-0000-0000 형식으로 포맷팅
    if (limited.length <= 3) {
      return limited;
    } else if (limited.length <= 7) {
      return `${limited.slice(0, 3)}-${limited.slice(3)}`;
    } else {
      return `${limited.slice(0, 3)}-${limited.slice(3, 7)}-${limited.slice(7)}`;
    }
  };

  const validateField = async (name: string, value: string): Promise<string> => {
    switch (name) {
      case 'email':
        if (!value.trim()) return '이메일을 입력해주세요';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return '올바른 이메일 형식이 아닙니다';
        }
        return '';
      case 'password':
        if (!value.trim()) return '비밀번호를 입력해주세요';
        if (value.length < 8 || value.length > 16) {
          return '비밀번호는 8-16자로 입력해주세요';
        }
        if (!/^(?=.*[a-zA-Z])(?=.*[0-9])/.test(value)) {
          return '영문과 숫자를 포함하여 입력해주세요';
        }
        return '';
      case 'passwordConfirm':
        if (!value.trim()) return '비밀번호 확인을 입력해주세요';
        if (value !== formData.password) {
          return '비밀번호가 일치하지 않습니다';
        }
        return '';
      case 'name':
        if (!value.trim()) return '이름을 입력해주세요';
        if (value.length < 2) return '이름은 2자 이상이어야 합니다';
        if (!/^[가-힣a-zA-Z\s]+$/.test(value)) {
          return '이름은 한글, 영문 대소문자만 사용 가능합니다';
        }
        // DB 중복 체크
        try {
          const response = await api.get(`/users/check-name/${encodeURIComponent(value)}`);
          if (!response.success && response.error?.includes('already exists')) {
            return '이미 사용 중인 이름입니다';
          }
        } catch (error) {
          // API 에러는 무시 (서버에서 체크)
        }
        return '';
      case 'nickname':
        if (!value.trim()) return '닉네임을 입력해주세요';
        if (value.length < 2) return '닉네임은 2자 이상이어야 합니다';
        if (!/^[가-힣a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+$/.test(value)) {
          return '닉네임은 한글, 영문 대소문자, 숫자, 특수문자만 사용 가능합니다';
        }
        // DB 중복 체크
        try {
          const response = await api.get(`/users/check-username/${encodeURIComponent(value)}`);
          if (!response.success && response.error?.includes('already exists')) {
            return '이미 사용 중인 닉네임입니다';
          }
        } catch (error) {
          // API 에러는 무시 (서버에서 체크)
        }
        return '';
      case 'phone':
        const phoneNumbers = value.replace(/[^0-9]/g, '');
        if (!phoneNumbers) return '휴대폰 번호를 입력해주세요';
        if (phoneNumbers.length !== 11) {
          return '휴대폰 번호는 11자리여야 합니다';
        }
        if (!/^010/.test(phoneNumbers)) {
          return '010으로 시작하는 번호를 입력해주세요';
        }
        return '';
      case 'verificationCode':
        if (!value.trim()) return '인증번호를 입력해주세요';
        if (value.length !== 6) {
          return '인증번호는 6자리입니다';
        }
        return '';
      default:
        return '';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    // 휴대폰 번호는 포맷팅 적용
    if (name === 'phone') {
      const formatted = formatPhoneNumber(value);
      setFormData({
        ...formData,
        [name]: formatted,
      });
    } else {
      setFormData({
        ...formData,
        [name]: value,
      });
    }
    
    // 실시간 검증 (비동기 검증은 blur에서만)
    if (errors[name] && name !== 'name' && name !== 'nickname') {
      validateField(name, name === 'phone' ? formatPhoneNumber(value) : value).then((error) => {
        if (error) {
          setErrors({
            ...errors,
            [name]: error,
          });
        } else {
          const newErrors = { ...errors };
          delete newErrors[name];
          setErrors(newErrors);
        }
      });
    }
  };

  const handleBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const error = await validateField(name, value);
    setErrors({
      ...errors,
      [name]: error,
    });
  };

  const handleUserTypeSelect = (userType: 'PERSONAL' | 'ORGANIZATION') => {
    setFormData({ ...formData, userType });
  };

  const handleNext = () => {
    if (formData.userType) {
      setStep('form');
    }
  };

  const handleAgreementChange = (type: 'all' | 'service' | 'privacy') => {
    if (type === 'all') {
      const newValue = !agreements.all;
      setAgreements({
        all: newValue,
        service: newValue,
        privacy: newValue,
      });
    } else {
      setAgreements({
        ...agreements,
        [type]: !agreements[type],
        all: false, // 개별 체크 시 전체 동의 해제
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setFileCount(files.length);
    }
  };

  const handleSendVerification = () => {
    // 개발용: 6자리 랜덤 인증번호 생성
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setDevVerificationCode(code);
    setVerificationCodeSent(true);
    console.log('인증번호 전송:', code);
    // TODO: 실제 인증번호 전송 로직
  };

  const handleVerify = () => {
    if (formData.verificationCode === devVerificationCode) {
      console.log('인증번호 확인 성공');
      setIsVerified(true);
      setErrors({
        ...errors,
        verificationCode: '',
      });
    } else {
      setIsVerified(false);
      setErrors({
        ...errors,
        verificationCode: '인증번호가 일치하지 않습니다',
      });
    }
    // TODO: 실제 인증번호 확인 로직
  };

  // 회원가입 버튼 활성화 조건 체크
  const isFormValid = () => {
    // 필수 필드 체크
    const hasEmail = formData.email.trim() !== '';
    const hasPassword = formData.password.trim() !== '';
    const hasPasswordConfirm = formData.passwordConfirm.trim() !== '';
    const hasName = formData.name.trim() !== '';
    const hasNickname = formData.nickname.trim() !== '';
    const hasPhone = formData.phone.trim() !== '';
    const hasUserType = formData.userType !== null;
    const isPhoneVerified = isVerified;
    const hasAgreements = agreements.service && agreements.privacy;
    
    return hasEmail && 
           hasPassword && 
           hasPasswordConfirm && 
           hasName && 
           hasNickname && 
           hasPhone && 
           hasUserType && 
           isPhoneVerified && 
           hasAgreements;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 전체 필드 검증
    const newErrors: Record<string, string> = {};
    for (const key of ['email', 'password', 'passwordConfirm', 'name', 'nickname', 'phone', 'verificationCode']) {
      const value = formData[key as keyof typeof formData];
      if (value !== null && value !== undefined) {
        const error = await validateField(key, String(value));
        if (error) newErrors[key] = error;
      }
    }

    // 약관 동의 확인
    if (!agreements.service || !agreements.privacy) {
      newErrors.agreement = '필수 약관에 동의해주세요';
    }
    
    setErrors(newErrors);
    
    if (Object.keys(newErrors).length > 0) {
      return;
    }
    
    setLoading(true);
    
    const result = await signup({
      username: formData.nickname,
      name: formData.name,
      email: formData.email,
      password: formData.password,
      phone: formData.phone.replace(/[^0-9]/g, ''), // 숫자만 전송
      userType: formData.userType || 'PERSONAL',
    });
    
    if (result.success) {
      navigate('/');
    } else {
      setErrors({
        submit: result.error || '회원가입에 실패했습니다',
      });
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen text-white flex flex-col" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-md mx-auto w-full flex-1 pb-24 flex flex-col">
        {/* 네비게이션 바 */}
        <div className="flex items-center mb-6">
          <button
            onClick={() => {
              if (step === 'form') {
                setStep('select');
              } else {
                navigate('/login');
              }
            }}
            className="mr-4 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">회원가입</h1>
        </div>
        
        {/* 1단계: 회원 타입 선택 */}
        <AnimatePresence mode="wait">
          {step === 'select' && (
            <motion.div
              key="select"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col justify-center items-center space-y-4"
            >
              {/* 통합 카드 컨테이너 */}
              <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
                {/* 개인 회원 카드 */}
                <motion.button
                  type="button"
                  onClick={() => handleUserTypeSelect('PERSONAL')}
                  className={`w-full p-5 text-left transition-all relative ${
                    formData.userType === 'PERSONAL'
                      ? 'bg-opacity-100'
                      : 'bg-opacity-60'
                  }`}
                  style={{ backgroundColor: formData.userType === 'PERSONAL' ? '#2A2A2A' : '#1A1A1A' }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="pr-24 min-h-[100px]">
                    <h3 className="text-lg font-semibold mb-1.5 text-white">개인 회원</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      개인의 두뇌·신체 데이터를 기반으로 맞춤 분석과 트레이닝을 이용합니다.
                    </p>
                  </div>
                  <div className={`absolute bottom-5 right-5 transition-colors ${
                    formData.userType === 'PERSONAL' 
                      ? 'text-lime-500' 
                      : 'text-gray-600'
                  }`}>
                    <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24" style={{ width: '80px', height: '80px' }}>
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                    </svg>
                  </div>
                </motion.button>
                
                {/* 구분선 */}
                <div className="h-px" style={{ backgroundColor: '#2A2A2A' }}></div>
                
                {/* 기업 회원 카드 */}
                <motion.button
                  type="button"
                  onClick={() => handleUserTypeSelect('ORGANIZATION')}
                  className={`w-full p-5 text-left transition-all relative ${
                    formData.userType === 'ORGANIZATION'
                      ? 'bg-opacity-100'
                      : 'bg-opacity-60'
                  }`}
                  style={{ backgroundColor: formData.userType === 'ORGANIZATION' ? '#2A2A2A' : '#1A1A1A' }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="pr-24 min-h-[100px]">
                    <h3 className="text-lg font-semibold mb-1.5 text-white">기업 회원</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      센터·학교·회사 등 여러 구성원의 데이터를 통합 관리하고 트레이닝을 운영합니다.
                    </p>
                  </div>
                  <div className={`absolute bottom-5 right-5 transition-colors ${
                    formData.userType === 'ORGANIZATION' 
                      ? 'text-lime-500' 
                      : 'text-gray-600'
                  }`}>
                    <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24" style={{ width: '70px', height: '70px' }}>
                      <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>
                    </svg>
                  </div>
                </motion.button>
              </div>
            </motion.div>
          )}
          
          {/* 다음 버튼 - 화면 하단 고정 */}
          {step === 'select' && (
            <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-4 flex justify-center" style={{ backgroundColor: '#0A0A0A', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
              <div className="w-full max-w-md">
                <motion.button
                  type="button"
                  onClick={handleNext}
                  disabled={!formData.userType}
                  className={`w-full py-4 rounded-3xl font-semibold transition-all ${
                    formData.userType
                      ? 'bg-lime-500 hover:bg-lime-600 active:scale-95'
                      : 'bg-gray-800 cursor-not-allowed'
                  }`}
                  style={formData.userType ? { color: '#000000', backgroundColor: '#AAED10' } : { color: '#B6B6B9' }}
                  whileHover={formData.userType ? { scale: 1.02 } : {}}
                  whileTap={formData.userType ? { scale: 0.98 } : {}}
                >
                  다음
                </motion.button>
              </div>
            </div>
          )}
          
          {/* 2단계: 정보 입력 */}
          {step === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* 이메일 */}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                    이메일
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 rounded-lg transition-all outline-none ${
                      errors.email
                        ? 'bg-red-900/20 border-2 border-red-500 text-white'
                        : 'bg-gray-800 border border-gray-700 text-white focus:ring-2 focus:ring-lime-500 focus:border-transparent'
                    }`}
                    placeholder="이메일 주소를 입력해 주세요."
                    disabled={loading}
                    style={{ backgroundColor: '#373C39', borderColor: errors.email ? '#ef4444' : '#4B5563' }}
                  />
                  <AnimatePresence>
                    {errors.email && (
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-1 text-sm text-red-400"
                      >
                        {errors.email}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 비밀번호 통합 박스 */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                    비밀번호
                  </label>
                  <div className="rounded-lg overflow-hidden" style={{ backgroundColor: '#373C39', border: `1px solid ${errors.password || errors.passwordConfirm ? '#ef4444' : '#4B5563'}` }}>
                    {/* 비밀번호 입력 */}
                    <div className="px-4 py-3 border-b" style={{ borderColor: '#4B5563' }}>
                      <input
                        id="password"
                        name="password"
                        type="password"
                        value={formData.password}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className="w-full bg-transparent text-white placeholder-gray-500 focus:outline-none"
                        placeholder="영문과 숫자를 포함하여 8~16자로 입력해 주세요."
                        disabled={loading}
                        maxLength={16}
                        style={{ color: formData.password ? '#ffffff' : '#B6B6B9' }}
                      />
                    </div>
                    {/* 비밀번호 확인 */}
                    <div className="px-4 py-3 relative">
                      <input
                        id="passwordConfirm"
                        name="passwordConfirm"
                        type={showPasswordConfirm ? 'text' : 'password'}
                        value={formData.passwordConfirm}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className="w-full bg-transparent text-white placeholder-gray-500 focus:outline-none pr-12"
                        placeholder="비밀번호 확인"
                        disabled={loading}
                        maxLength={16}
                        style={{ color: formData.passwordConfirm ? '#ffffff' : '#B6B6B9' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
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
                  <AnimatePresence>
                    {(errors.password || errors.passwordConfirm) && (
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-1 text-sm text-red-400"
                      >
                        {errors.password || errors.passwordConfirm}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 이름 */}
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-white mb-2">
                    이름
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    value={formData.name}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    autoComplete="off"
                    className={`w-full px-4 py-3 rounded-lg transition-all outline-none ${
                      errors.name
                        ? 'bg-red-900/20 border-2 border-red-500 text-white'
                        : 'bg-gray-800 border border-gray-700 text-white focus:ring-2 focus:ring-lime-500 focus:border-transparent'
                    }`}
                    placeholder="이름을 입력해 주세요."
                    disabled={loading}
                    style={{ backgroundColor: '#373C39', borderColor: errors.name ? '#ef4444' : '#4B5563' }}
                  />
                  <AnimatePresence>
                    {errors.name && (
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-1 text-sm text-red-400"
                      >
                        {errors.name}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 닉네임 */}
                <div>
                  <label htmlFor="nickname" className="block text-sm font-medium text-white mb-2">
                    닉네임
                  </label>
                  <input
                    id="nickname"
                    name="nickname"
                    type="text"
                    value={formData.nickname}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    autoComplete="off"
                    className={`w-full px-4 py-3 rounded-lg transition-all outline-none ${
                      errors.nickname
                        ? 'bg-red-900/20 border-2 border-red-500 text-white'
                        : 'bg-gray-800 border border-gray-700 text-white focus:ring-2 focus:ring-lime-500 focus:border-transparent'
                    }`}
                    placeholder="닉네임을 입력해 주세요."
                    disabled={loading}
                    style={{ backgroundColor: '#373C39', borderColor: errors.nickname ? '#ef4444' : '#4B5563' }}
                  />
                  <AnimatePresence>
                    {errors.nickname && (
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-1 text-sm text-red-400"
                      >
                        {errors.nickname}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 휴대폰 번호 */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label htmlFor="phone" className="block text-lg font-semibold text-white">
                      휴대폰 번호 인증
                    </label>
                    {verificationCodeSent && devVerificationCode && (
                      <span className="text-sm text-lime-500 font-mono">
                        [{devVerificationCode}]
                      </span>
                    )}
                  </div>
                  <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#373C39', border: '1px solid #4B5563' }}>
                    {/* 첫 번째 행: 휴대폰 번호 입력 + 인증번호 전송 */}
                    <div className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: '#4B5563' }}>
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none"
                        placeholder="휴대폰 번호"
                        disabled={loading}
                        maxLength={13}
                        style={{ color: formData.phone ? '#ffffff' : '#B6B6B9' }}
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
                        id="verificationCode"
                        name="verificationCode"
                        type="text"
                        value={formData.verificationCode}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none"
                        placeholder="인증번호"
                        disabled={loading || !verificationCodeSent || isVerified}
                        maxLength={6}
                        style={{ color: formData.verificationCode ? '#ffffff' : '#B6B6B9' }}
                      />
                      <button
                        type="button"
                        onClick={handleVerify}
                        disabled={isVerified || !verificationCodeSent || !formData.verificationCode || formData.verificationCode.length !== 6}
                        className="px-5 py-2.5 font-semibold transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ 
                          backgroundColor: isVerified ? '#373C39' : '#373C39',
                          color: isVerified ? '#ffffff' : ((!verificationCodeSent || !formData.verificationCode || formData.verificationCode.length !== 6) ? '#B6B6B9' : '#ffffff'),
                          borderRadius: '9999px'
                        }}
                      >
                        {isVerified ? '인증완료' : '인증하기'}
                      </button>
                    </div>
                  </div>
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
                  <AnimatePresence>
                    {(errors.phone || errors.verificationCode) && !isVerified && (
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-1 text-sm text-red-400"
                      >
                        {errors.phone || errors.verificationCode}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 증빙자료 첨부 (기업 회원만) */}
                {formData.userType === 'ORGANIZATION' && (
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-2">
                      <label htmlFor="file" className="block text-sm font-medium text-white">
                        증빙자료 첨부
                      </label>
                      <div className="relative" ref={tooltipRef}>
                        <button
                          type="button"
                          onClick={() => setShowTooltip(!showTooltip)}
                          onMouseEnter={() => setShowTooltip(true)}
                          className="w-5 h-5 rounded-full border border-white flex items-center justify-center text-white text-xs hover:bg-gray-700 transition-colors"
                        >
                          ?
                        </button>
                        <AnimatePresence>
                          {showTooltip && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="absolute top-8 left-0 z-50 w-64 p-4 bg-gray-800 border border-gray-700 rounded-lg shadow-lg"
                              style={{ backgroundColor: '#1F2937' }}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="text-white font-semibold text-sm">증빙자료 첨부</h4>
                                <button
                                  type="button"
                                  onClick={() => setShowTooltip(false)}
                                  className="text-gray-400 hover:text-white"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                              <p className="text-gray-300 text-xs leading-relaxed">
                                증빙자료는 신청 내용의 사실 여부를 확인하기 위해 사용됩니다. 내용을 명확히 확인할 수 있는 자료를 첨부해 주세요.
                              </p>
                              {/* 말풍선 꼬리 */}
                              <div className="absolute -top-2 left-4 w-4 h-4 bg-gray-800 border-l border-t border-gray-700 transform rotate-45" style={{ backgroundColor: '#1F2937' }}></div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    <label
                      htmlFor="file"
                      className="block px-4 py-3 rounded-lg cursor-pointer transition-colors"
                      style={{ backgroundColor: '#373C39', border: '1px solid #4B5563' }}
                    >
                      <div className="flex items-center justify-between text-white">
                        <span>파일 선택</span>
                        <span className="text-gray-400">{fileCount}</span>
                      </div>
                    </label>
                    <input
                      id="file"
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                      disabled={loading}
                    />
                  </div>
                )}
                
                {/* 약관 동의 */}
                <div>
                  <label className="block text-sm font-medium text-white mb-3">
                    약관 동의
                  </label>
                  <div>
                    <label className="flex items-center cursor-pointer pb-3">
                      <input
                        type="checkbox"
                        checked={agreements.all}
                        onChange={() => handleAgreementChange('all')}
                        className="w-5 h-5 rounded border-gray-600 text-lime-500 focus:ring-lime-500 focus:ring-2"
                        style={{ accentColor: '#84cc16' }}
                      />
                      <span className="ml-2 text-white">전체 동의</span>
                    </label>
                    {/* 구분선 */}
                    <div className="h-px mb-3" style={{ backgroundColor: '#4B5563' }}></div>
                    <label className="flex items-center justify-between cursor-pointer mb-1">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={agreements.service}
                          onChange={() => handleAgreementChange('service')}
                          className="w-5 h-5 rounded border-gray-600 text-lime-500 focus:ring-lime-500 focus:ring-2"
                          style={{ accentColor: '#84cc16' }}
                        />
                        <span className="ml-2 text-white">
                          {terms.service?.title || '서비스 이용약관 동의'} <span className="text-lime-500">(필수)</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTermsType('SERVICE');
                          setShowTermsModal(true);
                        }}
                        className="text-lime-500 text-sm hover:underline"
                      >
                        내용보기
                      </button>
                    </label>
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={agreements.privacy}
                          onChange={() => handleAgreementChange('privacy')}
                          className="w-5 h-5 rounded border-gray-600 text-lime-500 focus:ring-lime-500 focus:ring-2"
                          style={{ accentColor: '#84cc16' }}
                        />
                        <span className="ml-2 text-white">
                          {terms.privacy?.title || '개인정보 수집 및 이용 동의'} <span className="text-lime-500">(필수)</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTermsType('PRIVACY');
                          setShowTermsModal(true);
                        }}
                        className="text-lime-500 text-sm hover:underline"
                      >
                        내용보기
                      </button>
                    </label>
                  </div>
                  <AnimatePresence>
                    {errors.agreement && (
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-2 text-sm text-red-400"
                      >
                        {errors.agreement}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 전체 에러 메시지 */}
                <AnimatePresence>
                  {errors.submit && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 bg-red-900/20 border border-red-500 rounded-lg"
                    >
                      <p className="text-sm text-red-400">{errors.submit}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* 회원가입 버튼 */}
                <button
                  type="submit"
                  disabled={loading || !isFormValid()}
                  className={`w-full py-4 font-semibold transition-all mt-6 ${
                    loading || !isFormValid()
                      ? 'bg-gray-800 cursor-not-allowed'
                      : 'bg-gray-800 hover:bg-gray-700 active:scale-95'
                  }`}
                  style={{ 
                    color: loading || !isFormValid() ? '#B6B6B9' : '#ffffff',
                    backgroundColor: '#373C39',
                    borderRadius: '9999px'
                  }}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                      />
                      가입 중...
                    </span>
                  ) : (
                    '회원가입'
                  )}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 약관 모달 */}
      <TermsModal
        isOpen={showTermsModal}
        onClose={() => {
          setShowTermsModal(false);
          setSelectedTermsType(null);
        }}
        terms={
          selectedTermsType === 'SERVICE' && terms.service
            ? { 
                id: terms.service.id, 
                type: 'SERVICE', 
                title: terms.service.title, 
                content: terms.service.content, 
                isRequired: true, 
                isActive: true, 
                version: terms.service.version || 1, 
                createdAt: terms.service.createdAt || '', 
                updatedAt: terms.service.updatedAt 
              }
            : selectedTermsType === 'PRIVACY' && terms.privacy
            ? { 
                id: terms.privacy.id, 
                type: 'PRIVACY', 
                title: terms.privacy.title, 
                content: terms.privacy.content, 
                isRequired: true, 
                isActive: true, 
                version: terms.privacy.version || 1, 
                createdAt: terms.privacy.createdAt || '', 
                updatedAt: terms.privacy.updatedAt 
              }
            : null
        }
        title={selectedTermsType === 'SERVICE' ? terms.service?.title : terms.privacy?.title}
      />
    </div>
  );
}
