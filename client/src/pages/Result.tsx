import { motion } from 'framer-motion';

/**
 * 결과 페이지
 * 게임 결과 및 통계 표시
 */
export default function Result() {
  return (
    <div className="min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-2xl font-bold mb-6">결과</h1>
        {/* TODO: Figma 디자인 기반 결과 UI 구현 */}
      </motion.div>
    </div>
  );
}
