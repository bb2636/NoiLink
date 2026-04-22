/**
 * 트레이닝 진행 화면 (이미지 1~3 디자인)
 *
 * 상태:
 *  - 시작 (elapsed = 0): 빈 회색 원 + "00:00"
 *  - 진행 중: 초록 호가 시계방향 채워짐 + 흰 텍스트
 *  - 일시정지: 같은 호 + 회색 텍스트 + "재개" 버튼(초록)
 *  - 완료: 자동으로 결과 페이지로 이동
 *
 * 시간 표시 = 경과 시간 (count up). 진행도 = elapsed / total.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import type { Level, TrainingMode } from '@noilink/shared';
import { SESSION_MAX_MS } from '@noilink/shared';
import { submitCompletedTraining } from '../utils/submitTrainingRun';

export type TrainingRunState = {
  catalogId: string;
  apiMode: TrainingMode;
  userId: string;
  title: string;
  totalDurationSec: number;
  bpm: number;
  level: Level;
  yieldsScore: boolean;
  isComposite: boolean;
};

export default function TrainingSessionPlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TrainingRunState | null;

  const totalSec = state ? Math.min(state.totalDurationSec, SESSION_MAX_MS / 1000) : 0;
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!state || !state.userId || totalSec <= 0) {
      navigate('/training', { replace: true });
    }
  }, [state, totalSec, navigate]);

  // 1초 카운터 — 일시정지 시 멈춤
  useEffect(() => {
    if (!state || paused || elapsed >= totalSec) return;
    const id = window.setInterval(() => {
      setElapsed((e) => Math.min(totalSec, e + 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, paused, elapsed, totalSec]);

  const runSubmit = useCallback(async () => {
    if (!state || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setErr(null);
    const res = await submitCompletedTraining({
      userId: state.userId,
      mode: state.apiMode,
      bpm: state.bpm,
      level: state.level,
      totalDurationSec: totalSec,
      yieldsScore: state.yieldsScore,
      isComposite: state.isComposite,
      tapCount: 0,
    });
    setSubmitting(false);
    if (res.error) {
      setErr(res.error);
      submitLock.current = false;
      return;
    }
    navigate('/result', {
      replace: true,
      state: {
        title: state.title,
        displayScore: res.displayScore,
        yieldsScore: state.yieldsScore,
        sessionId: res.sessionId,
      },
    });
  }, [state, totalSec, navigate]);

  // 완료 시 자동 제출
  useEffect(() => {
    if (state && elapsed >= totalSec && totalSec > 0 && !submitLock.current) {
      void runSubmit();
    }
  }, [elapsed, totalSec, state, runSubmit]);

  if (!state) return null;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const progress = totalSec > 0 ? elapsed / totalSec : 0;

  return (
    <MobileLayout hideBottomNav>
      <div
        className="max-w-md mx-auto px-4 py-6 flex flex-col min-h-screen"
        style={{ paddingBottom: '120px', color: '#fff' }}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-10">
          <button onClick={() => navigate('/training')} className="text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">트레이닝 진행</h1>
        </div>

        {/* BPM 칩 */}
        <div className="flex justify-center mb-10">
          <div
            className="px-8 py-3 rounded-2xl border-2 text-lg font-semibold"
            style={{ borderColor: '#AAED10', color: '#AAED10' }}
          >
            BPM&nbsp;&nbsp;{state.bpm}
          </div>
        </div>

        {/* 원형 타이머 */}
        <div className="flex justify-center mb-10">
          <CircularTimer
            totalSec={totalSec}
            elapsed={elapsed}
            mm={mm}
            ss={ss}
            progress={progress}
            paused={paused}
          />
        </div>

        {err && (
          <div className="mb-4 text-center">
            <p className="text-sm text-red-400 mb-2">{err}</p>
            <button
              onClick={() => void runSubmit()}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#AAED10', color: '#000' }}
            >
              저장 재시도
            </button>
          </div>
        )}

        {/* 하단 버튼: 취소 / 일시정지·재개 */}
        <div className="mt-auto flex items-center justify-between px-4">
          <button
            onClick={() => navigate('/training')}
            disabled={submitting}
            className="w-20 h-20 rounded-full font-semibold text-white"
            style={{ backgroundColor: '#2A2A2A' }}
          >
            취소
          </button>

          <button
            onClick={() => setPaused((p) => !p)}
            disabled={submitting || elapsed >= totalSec}
            className="w-20 h-20 rounded-full font-semibold text-white"
            style={{ backgroundColor: paused ? '#7A9637' : '#B0772A' }}
          >
            {paused ? '재개' : '일시정지'}
          </button>
        </div>

        {submitting && (
          <p className="text-center text-sm mt-4 text-gray-400">결과 저장 중…</p>
        )}
      </div>
    </MobileLayout>
  );
}

// =============================================================================
// 원형 타이머
// =============================================================================
function CircularTimer({
  totalSec,
  elapsed,
  mm,
  ss,
  progress,
  paused,
}: {
  totalSec: number;
  elapsed: number;
  mm: string;
  ss: string;
  progress: number;
  paused: boolean;
}) {
  const SIZE = 280;
  const STROKE = 12;
  const R = (SIZE - STROKE) / 2;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC * (1 - progress);

  const isRunning = elapsed > 0 && !paused && elapsed < totalSec;
  const textColor = paused ? '#666' : isRunning || elapsed > 0 ? '#fff' : '#fff';

  return (
    <div className="relative">
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        {/* 배경 원 */}
        <circle cx={CX} cy={CY} r={R} stroke="#3A3A3A" strokeWidth={STROKE} fill="none" />
        {/* 진행 호 */}
        {progress > 0 && (
          <circle
            cx={CX}
            cy={CY}
            r={R}
            stroke="#AAED10"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        )}
      </svg>
      {/* 중앙 텍스트 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm mb-1" style={{ color: paused ? '#555' : '#888' }}>
          {totalSec}초
        </span>
        <span
          className="text-6xl font-bold tabular-nums"
          style={{ color: textColor }}
        >
          {mm}:{ss}
        </span>
      </div>
    </div>
  );
}
