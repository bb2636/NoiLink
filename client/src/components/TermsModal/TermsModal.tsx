/**
 * 약관 표시 모달 컴포넌트
 */
import { motion, AnimatePresence } from 'framer-motion';
import type { Terms } from '@noilink/shared';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  terms: Terms | null;
  title?: string;
}

export default function TermsModal({ isOpen, onClose, terms, title }: TermsModalProps) {
  if (!isOpen) return null;

  // 약관 업데이트 날짜 포맷팅
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 오버레이 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          />

          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-x-0 bottom-0 top-0 z-50 overflow-hidden"
            style={{ backgroundColor: '#0A0A0A' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col h-full">
              {/* 헤더 */}
              <div 
                className="flex items-center gap-4 px-4 py-6"
                style={{ 
                  paddingTop: `calc(24px + env(safe-area-inset-top))`,
                }}
              >
                <button
                  onClick={onClose}
                  className="flex items-center"
                  style={{ color: '#FFFFFF' }}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
                  {title || terms?.title || '약관'}
                </h1>
              </div>

              {/* 내용
                  ─────────────────────────────────────────────
                  flex 컬럼 안에서 자식에 `flex-1 + overflow-y-auto` 만 주면,
                  flex 자식의 기본 `min-height: auto` 가 콘텐츠 높이로 잡혀서
                  부모(`h-full`)보다 자식이 더 커지는 순간 overflow 가 부모를
                  넘어서 버린다. 그 결과 내부 스크롤이 활성화되지 않고,
                  긴 약관 본문의 아래쪽이 잘려 보이게 된다.
                  → `min-h-0` 으로 자식이 부모보다 줄어들 수 있게 만들어야
                    `overflow-y-auto` 가 실제 스크롤로 동작한다. */}
              <div 
                className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pb-6"
                style={{ 
                  paddingBottom: `calc(24px + env(safe-area-inset-bottom))`,
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                }}
              >
                {terms ? (
                  <div className="space-y-4">
                    {/* 날짜 */}
                    {terms.updatedAt && (
                      <div style={{ color: '#FFFFFF' }}>
                        <div className="text-sm mb-1" style={{ color: '#999999' }}>
                          {formatDate(terms.updatedAt)}
                        </div>
                      </div>
                    )}

                    {/* 약관 내용 */}
                    <div style={{ color: '#FFFFFF' }}>
                      <div className="whitespace-pre-wrap leading-relaxed">{terms.content}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8" style={{ color: '#999999' }}>
                    약관 내용을 불러오는 중입니다...
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
