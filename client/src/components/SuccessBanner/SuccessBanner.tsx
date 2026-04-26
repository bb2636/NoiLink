import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

interface SuccessBannerProps {
  isOpen: boolean;
  message: string;
  onClose?: () => void;
  autoClose?: boolean;
  duration?: number;
  backgroundColor?: string;
  textColor?: string;
}

export default function SuccessBanner({
  isOpen,
  message,
  onClose,
  autoClose = true,
  duration = 3000,
  backgroundColor,
  textColor,
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
            className="w-full max-w-md rounded-lg px-4 py-3"
            style={{ backgroundColor: backgroundColor || '#1A1A1A' }}
          >
            {/* whiteSpace: 'pre-line' — message 안의 '\n' 을 시각적인 줄바꿈으로 노출.
                여러 줄짜리 안내(예: BLE 자동 종료 + 환경 점검 가이드 — Task #43)가
                한 줄로 합쳐 보이지 않도록 한다. */}
            <p
              className="text-sm text-center"
              style={{ color: textColor || '#FFFFFF', whiteSpace: 'pre-line' }}
            >{message}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
