/**
 * NoiLink 로고 컴포넌트
 * 스플래시, 로그인, 홈 화면 등에서 재사용 가능
 */

import logoImage from '../../assets/noilink_logo.png';

interface LogoProps {
  /** 로고 크기 (기본값: 'md') */
  size?: 'sm' | 'md' | 'lg';
  /** 커스텀 클래스명 */
  className?: string;
}

export default function Logo({ size = 'md', className = '' }: LogoProps) {
  const sizeClasses = {
    sm: 'h-6',
    md: 'h-8',
    lg: 'h-12',
  };

  return (
    <div className={`flex items-center ${sizeClasses[size]} ${className}`}>
      <img 
        src={logoImage} 
        alt="NoiLink" 
        className="h-full w-auto object-contain"
      />
    </div>
  );
}
