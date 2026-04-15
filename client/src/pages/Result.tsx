import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';

export type TrainingResultState = {
  title: string;
  displayScore?: number;
  yieldsScore: boolean;
  sessionId?: string;
};

/**
 * 트레이닝 결과 — 세션 저장 후 이동
 */
export default function Result() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TrainingResultState | null;
  const hasPayload =
    state &&
    (Boolean(state.title) ||
      state.sessionId != null ||
      state.yieldsScore !== undefined ||
      state.displayScore != null);

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-8" style={{ paddingBottom: '120px' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45 }}
        >
          <h1 className="text-2xl font-bold mb-2" style={{ color: '#fff' }}>
            {hasPayload ? '수고했어요' : '결과 없음'}
          </h1>
          {!hasPayload ? (
            <p className="text-sm mb-6 leading-relaxed" style={{ color: '#999' }}>
              트레이닝을 마친 뒤 이 화면으로 이동해야 점수·세션 정보가 표시됩니다. 주소창으로 직접 들어온 경우에는
              아래에서 다시 시작할 수 있어요.
            </p>
          ) : state?.title ? (
            <p className="text-sm mb-6" style={{ color: '#999' }}>
              {state.title}
            </p>
          ) : null}

          {!hasPayload ? null : state?.yieldsScore === false ? (
            <p className="text-base mb-8 leading-relaxed" style={{ color: '#ccc' }}>
              자유 트레이닝은 점수를 산출하지 않습니다. 합계 시간·스트릭에만 반영됩니다.
            </p>
          ) : (
            <div
              className="w-44 h-44 mx-auto mb-8 rounded-full flex flex-col items-center justify-center border-4"
              style={{ borderColor: '#AAED10' }}
            >
              <span className="text-xs font-semibold mb-1" style={{ color: '#888' }}>
                6대 지표 평균(참고)
              </span>
              <span className="text-5xl font-extrabold" style={{ color: '#fff' }}>
                {state?.displayScore != null ? state.displayScore : '—'}
              </span>
            </div>
          )}

          {hasPayload && state?.sessionId ? (
            <p className="text-[11px] text-center mb-6" style={{ color: '#555' }}>
              세션 ID: {state.sessionId}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            {hasPayload ? (
              <button
                type="button"
                className="w-full py-4 rounded-2xl font-bold text-base"
                style={{ backgroundColor: '#AAED10', color: '#000' }}
                onClick={() => navigate('/report')}
              >
                리포트 보기
              </button>
            ) : null}
            <button
              type="button"
              className="w-full py-3 rounded-2xl font-semibold border"
              style={{ borderColor: '#444', color: '#fff' }}
              onClick={() => navigate('/training')}
            >
              트레이닝 목록
            </button>
            <button
              type="button"
              className="w-full py-3 rounded-2xl text-sm"
              style={{ color: '#888' }}
              onClick={() => navigate('/')}
            >
              홈
            </button>
          </div>
        </motion.div>
      </div>
    </MobileLayout>
  );
}
