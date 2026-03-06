/**
 * 공통 모달 컴포넌트
 */
import { ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
  position?: 'center' | 'right';
}

export default function Modal({ isOpen, onClose, title, children, width = '600px', position = 'center' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  if (position === 'right') {
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
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
            />

            {/* 오른쪽 사이드 패널 */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="fixed right-0 top-0 bottom-0 z-50 bg-white shadow-xl flex flex-col"
              style={{ width }}
            >
              {title && (
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0" style={{ borderColor: '#E5E5E5' }}>
                  <h2 className="text-xl font-semibold" style={{ color: '#000000' }}>
                    {title}
                  </h2>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="p-6 flex-1 overflow-auto">
                {children}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={onClose}
        >
          {/* 오버레이 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          />

          {/* 모달 컨텐츠 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-lg shadow-xl"
            style={{ width, maxHeight: '90vh', overflow: 'auto' }}
          >
            {title && (
              <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: '#E5E5E5' }}>
                <h2 className="text-xl font-semibold" style={{ color: '#000000' }}>
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>
            )}
            <div className="p-6">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
