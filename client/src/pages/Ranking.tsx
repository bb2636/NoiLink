import { motion } from 'framer-motion';

/**
 * 랭킹 페이지
 * 전체 랭킹 및 개인 리포트
 */
export default function Ranking() {
  return (
    <div className="min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-2xl font-bold mb-6">랭킹</h1>
        {/* TODO: Figma 디자인 기반 랭킹 UI 구현 */}
      </motion.div>
    </div>
  );
}
