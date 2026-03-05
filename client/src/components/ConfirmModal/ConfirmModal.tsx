import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = '확인',
  cancelText = '아니요',
  onConfirm,
  onCancel,
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
              style={{ backgroundColor: '#2A2A2A' }}
            >
              <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
              <p className="text-gray-300 mb-6">{message}</p>
              
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 px-4 rounded-lg font-medium transition-colors"
                  style={{ 
                    backgroundColor: '#373C39',
                    color: '#ffffff'
                  }}
                >
                  {cancelText}
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 py-3 px-4 rounded-lg font-medium transition-colors text-black"
                  style={{ 
                    backgroundColor: '#AAED10',
                    color: '#000000'
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
