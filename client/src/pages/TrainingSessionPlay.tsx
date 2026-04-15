/**
 * 웹 트레이닝 진행(타이머) → 종료 시 세션·메트릭 제출 → 결과 화면
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

  const capSec = state ? Math.min(state.totalDurationSec, SESSION_MAX_MS / 1000) : 0;
  const [remaining, setRemaining] = useState(capSec);
  const [paused, setPaused] = useState(false);
  const [taps, setTaps] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitLock = useRef(false);
  const prevRemaining = useRef(remaining);

  useEffect(() => {
    if (!state || !state.userId || capSec <= 0) {
      navigate('/training', { replace: true });
    }
  }, [state, capSec, navigate]);

  useEffect(() => {
    if (!state || paused || remaining <= 0) return;
    const id = window.setInterval(() => {
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, paused, remaining]);

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
      totalDurationSec: capSec,
      yieldsScore: state.yieldsScore,
      isComposite: state.isComposite,
      tapCount: taps,
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
  }, [state, capSec, taps, navigate]);

  useEffect(() => {
    const crossed = prevRemaining.current > 0 && remaining === 0;
    prevRemaining.current = remaining;
    if (!state || !crossed) return;
    void runSubmit();
  }, [remaining, state, runSubmit]);

  if (!state) {
    return null;
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <MobileLayout>
      <div
        className="max-w-md mx-auto px-4 py-6 flex flex-col min-h-[70vh]"
        style={{ paddingBottom: '120px', color: '#fff' }}
      >
        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => navigate(-1)} className="text-white text-lg">
            ‹
          </button>
          <h1 className="text-lg font-bold">트레이닝</h1>
          <span className="w-6" />
        </div>

        <p className="text-sm mb-2" style={{ color: '#999' }}>
          {state.title} · BPM {state.bpm} · Lv{state.level}
        </p>

        <button
          type="button"
          className="flex-1 min-h-[200px] rounded-2xl border-2 border-dashed mb-4 flex flex-col items-center justify-center gap-2"
          style={{ borderColor: '#444', backgroundColor: '#141414' }}
          onClick={() => setTaps((t) => t + 1)}
          disabled={submitting || remaining === 0}
        >
          <span className="text-3xl font-bold" style={{ color: '#AAED10' }}>
            {taps}
          </span>
          <span className="text-xs" style={{ color: '#888' }}>
            화면을 눌러 반응(데모). 종료 시 서버에 반영됩니다.
          </span>
        </button>

        <div className="text-center py-6">
          <div className="text-5xl font-extrabold tabular-nums">
            {mm}:{ss}
          </div>
          <p className="text-xs mt-2" style={{ color: '#666' }}>
            상한 {SESSION_MAX_MS / 1000}s
          </p>
        </div>

        {remaining > 0 && (
          <button
            type="button"
            className="mb-3 py-2 rounded-xl text-sm font-semibold w-full"
            style={{ backgroundColor: '#2a2a2a', color: '#ccc' }}
            onClick={() => setRemaining(0)}
            disabled={submitting}
          >
            지금 종료하고 저장
          </button>
        )}

        {err && (
          <div className="mb-3 space-y-2">
            <p className="text-sm text-center" style={{ color: '#f87171' }}>
              {err}
            </p>
            <button
              type="button"
              className="w-full py-2 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#AAED10', color: '#000' }}
              onClick={() => void runSubmit()}
              disabled={submitting}
            >
              저장 재시도
            </button>
          </div>
        )}

        <div className="flex gap-3 mt-auto">
          <button
            type="button"
            className="flex-1 py-3 rounded-2xl font-semibold"
            style={{ backgroundColor: '#2a2a2a', color: '#ccc' }}
            onClick={() => navigate('/training')}
            disabled={submitting}
          >
            취소
          </button>
          <button
            type="button"
            className="flex-1 py-3 rounded-2xl font-semibold"
            style={{ backgroundColor: '#333', color: '#fff' }}
            onClick={() => setPaused((p) => !p)}
            disabled={submitting}
          >
            {paused ? '재개' : '일시정지'}
          </button>
        </div>

        {submitting && (
          <p className="text-center text-sm mt-4" style={{ color: '#888' }}>
            결과 저장 중…
          </p>
        )}
      </div>
    </MobileLayout>
  );
}
