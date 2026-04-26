import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

interface SuccessBannerProps {
  isOpen: boolean;
  message: string;
  /**
   * 자체 `duration` 타이머가 발화했을 때 호출된다 — 사용자가 적극적으로
   * 닫은 것이 아니라 토스트가 자기 시간이 다 되어 사라진 케이스.
   * Task #129 이전에는 X 버튼이 없어 타이머와 사용자 의도가 한 통에 묶였지만,
   * 지금은 사용자 닫힘은 `onUserClose` 가 별도로 받는다.
   */
  onClose?: () => void;
  /**
   * 사용자가 X 닫기 버튼을 눌렀을 때만 호출된다 (Task #129).
   * `showCloseButton` 이 true 일 때만 의미가 있으며, 핸들러 안에서 직접
   * 토스트 상태를 비워(`setBanner(null)`) UI 를 닫고, 필요하면 텔레메트리도
   * 함께 흘려주면 된다 (`ackBannerSubRef.notifyDismissed()`).
   * 미제공 시 X 버튼은 fallback 으로 `onClose` 를 호출한다.
   */
  onUserClose?: () => void;
  autoClose?: boolean;
  duration?: number;
  backgroundColor?: string;
  textColor?: string;
  /**
   * 우측 상단에 작은 X 닫기 버튼을 노출한다 (Task #129).
   * 거부 토스트(빨간 변형) 처럼 "사용자가 적극 닫는 비율" 을 측정하고 싶은
   * 화면에서만 켠다. 기본값은 false 로, 기존 호출부(BLE 안정성 안내 등)는
   * 시각적 변화 없이 유지된다.
   */
  showCloseButton?: boolean;
  /** X 버튼 aria-label. 거부 토스트에는 "닫기" 가 적절. */
  closeButtonLabel?: string;
}

export default function SuccessBanner({
  isOpen,
  message,
  onClose,
  onUserClose,
  autoClose = true,
  duration = 3000,
  backgroundColor,
  textColor,
  showCloseButton = false,
  closeButtonLabel = '닫기',
}: SuccessBannerProps) {
  useEffect(() => {
    if (isOpen && autoClose && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoClose, duration, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-4 px-4"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <div
            className="w-full max-w-md rounded-lg px-4 py-3 relative"
            style={{ backgroundColor: backgroundColor || '#1A1A1A' }}
          >
            {/* whiteSpace: 'pre-line' — message 안의 '\n' 을 시각적인 줄바꿈으로 노출.
                여러 줄짜리 안내(예: BLE 자동 종료 + 환경 점검 가이드 — Task #43)가
                한 줄로 합쳐 보이지 않도록 한다. */}
            <p
              className="text-sm text-center"
              style={{
                color: textColor || '#FFFFFF',
                whiteSpace: 'pre-line',
                // X 버튼 영역과 텍스트가 겹치지 않도록 우측 여백 확보.
                paddingRight: showCloseButton ? '1.5rem' : undefined,
                paddingLeft: showCloseButton ? '1.5rem' : undefined,
              }}
            >{message}</p>
            {showCloseButton && (
              <button
                type="button"
                aria-label={closeButtonLabel}
                onClick={() => {
                  // 사용자 의도 — 텔레메트리 분리를 위해 `onClose` (timeout 경로)와
                  // 분리해 흘린다. `onUserClose` 가 없으면 기존 호환을 위해 onClose 로 폴백.
                  if (onUserClose) {
                    onUserClose();
                  } else if (onClose) {
                    onClose();
                  }
                }}
                className="absolute top-1/2 right-2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-base leading-none focus:outline-none focus:ring-1"
                style={{
                  color: textColor || '#FFFFFF',
                  background: 'transparent',
                }}
              >
                ×
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
