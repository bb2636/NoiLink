import { motion } from 'framer-motion';

/**
 * 홈 페이지
 * Figma 디자인 기반으로 구현 예정
 */
export default function Home() {
  return (
    <div className="min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md mx-auto"
      >
        <h1 className="text-3xl font-bold text-center mb-8">
          뇌지컬 트레이닝
        </h1>
        <p className="text-center text-gray-600 mb-8">
          인지 능력을 테스트하고 훈련하세요
        </p>
        {/* TODO: Figma 디자인 기반 UI 구현 */}
      </motion.div>
    </div>
  );
}
