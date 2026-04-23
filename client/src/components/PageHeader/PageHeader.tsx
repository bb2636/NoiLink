import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface PageHeaderProps {
  /** 좌측 아이콘(SVG 등) — 뒤로가기 버튼이 없을 때 표시되는 라벨 아이콘 */
  icon?: ReactNode;
  /** 헤더 가운데/좌측에 표시되는 제목 */
  title?: ReactNode;
  /** 좌측 뒤로가기 버튼 표시 여부 */
  showBack?: boolean;
  /** 뒤로가기 클릭 시 동작 (기본값: navigate(-1)) */
  onBack?: () => void;
  /** 우측 액션 영역 */
  right?: ReactNode;
  /** 추가 className */
  className?: string;
}

/**
 * 모든 페이지 상단바를 통일하기 위한 컴포넌트.
 * - sticky top:0 + paddingTop: env(safe-area-inset-top) 으로
 *   노치/상단바 안전영역까지 헤더 배경이 확장되어 콘텐츠가 가려지지 않습니다.
 * - 모든 페이지에서 동일한 높이/배경/보더를 사용해 시각적 일관성 확보.
 */
export default function PageHeader({
  icon,
  title,
  showBack = false,
  onBack,
  right,
  className = '',
}: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <header
      className={`sticky top-0 z-40 ${className}`}
      style={{
        backgroundColor: '#0A0A0A',
        borderBottom: '1px solid #1A1A1A',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="max-w-md mx-auto px-4 h-12 flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={handleBack}
            className="-ml-1 p-1"
            aria-label="뒤로"
          >
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        )}
        {icon && <span className="flex items-center text-white">{icon}</span>}
        {title && (
          <h1 className="text-[15px] font-semibold text-white truncate">
            {title}
          </h1>
        )}
        {right && <div className="ml-auto flex items-center">{right}</div>}
      </div>
    </header>
  );
}
