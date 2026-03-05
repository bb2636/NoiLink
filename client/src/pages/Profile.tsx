import { motion } from 'framer-motion';

/**
 * 프로필 페이지 (마이페이지)
 * 사용자 정보 및 통계 표시
 */
export default function Profile() {
  return (
    <div className="min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-2xl font-bold mb-6">마이페이지</h1>
        {/* TODO: Figma 디자인 기반 프로필 UI 구현 */}
      </motion.div>
    </div>
  );
}
