import { motion, AnimatePresence } from 'framer-motion';

import { ReactNode } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButtonStyle?: {
    backgroundColor?: string;
    color?: string;
  };
  cancelButtonStyle?: {
    backgroundColor?: string;
    color?: string;
  };
  modalStyle?: {
    backgroundColor?: string;
    titleColor?: string;
    messageColor?: string;
  };
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = '확인',
  cancelText = '아니요',
  onConfirm,
  onCancel,
  confirmButtonStyle,
  cancelButtonStyle,
  modalStyle,
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 배경 오버레이 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/50 z-40"
          />
          
          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-6"
              style={{ backgroundColor: modalStyle?.backgroundColor || '#2A2A2A' }}
            >
              <h2 className="text-xl font-bold mb-4 text-center" style={{ color: modalStyle?.titleColor || '#FFFFFF' }}>{title}</h2>
              <p className="mb-6 text-center" style={{ color: modalStyle?.messageColor || '#D1D5DB' }}>{message}</p>
              
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 px-4 rounded-lg font-medium transition-colors"
                  style={{ 
                    backgroundColor: cancelButtonStyle?.backgroundColor || '#373C39',
                    color: cancelButtonStyle?.color || '#ffffff'
                  }}
                >
                  {cancelText}
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 py-3 px-4 rounded-lg font-medium transition-colors"
                  style={{ 
                    backgroundColor: confirmButtonStyle?.backgroundColor || '#AAED10',
                    color: confirmButtonStyle?.color || '#000000'
                  }}
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
