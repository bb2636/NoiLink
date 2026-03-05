import { motion } from 'framer-motion';

/**
 * 회원가입 페이지
 */
export default function SignUp() {
  return (
    <div className="min-h-screen p-4 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <h1 className="text-3xl font-bold text-center mb-8">회원가입</h1>
        {/* TODO: Figma 디자인 기반 회원가입 폼 구현 */}
      </motion.div>
    </div>
  );
}
