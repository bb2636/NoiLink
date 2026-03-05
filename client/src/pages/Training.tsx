import { motion } from 'framer-motion';

/**
 * 트레이닝 페이지
 * 게임 목록 및 게임 실행 화면
 */
export default function Training() {
  return (
    <div className="min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-2xl font-bold mb-6">트레이닝</h1>
        {/* TODO: Figma 디자인 기반 게임 목록 및 게임 실행 UI 구현 */}
      </motion.div>
    </div>
  );
}
