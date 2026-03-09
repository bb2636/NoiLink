/**
 * 트레이닝 탭 - 트레이닝 선택 목록 (3번째 화면 레이아웃: 큰 이미지 + 제목 + 설명)
 */
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { TRAINING_LIST } from '../utils/trainingConfig';

export default function Training() {
  const navigate = useNavigate();

  const handleCardClick = (id: string) => {
    navigate(`/training/setup/${id}`);
  };

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-6" style={{ paddingBottom: '120px' }}>
        <div className="flex items-center gap-2 mb-6">
          <span className="text-2xl">⚡</span>
          <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
            트레이닝
          </h1>
        </div>

        <h2 className="text-base font-semibold mb-4" style={{ color: '#FFFFFF' }}>
          트레이닝 선택
        </h2>

        <div className="space-y-5">
          {TRAINING_LIST.map((item) => (
            <motion.article
              key={item.id}
              onClick={() => handleCardClick(item.id)}
              className="w-full rounded-2xl overflow-hidden text-left cursor-pointer"
              style={{ backgroundColor: '#1A1A1A' }}
              whileTap={{ scale: 0.98 }}
            >
              {/* 상단 큰 이미지 */}
              <div
                className="w-full aspect-[16/10] bg-cover bg-center"
                style={{
                  backgroundImage: `url(${item.image})`,
                  backgroundColor: '#2A2A2A',
                }}
              />
              {/* 제목 + 설명 */}
              <div className="p-4">
                <h3 className="font-bold text-lg mb-2" style={{ color: '#FFFFFF' }}>
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#999999' }}>
                  {item.desc}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </MobileLayout>
  );
}
