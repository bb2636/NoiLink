/**
 * 기록 페이지 — 최근 트레이닝 세션 목록
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import type { Session, TrainingMode } from '@noilink/shared';
import { TRAINING_CATALOG } from '@noilink/shared';

function modeTitle(mode: TrainingMode): string {
  const hit = TRAINING_CATALOG.find((e) => e.apiMode === mode);
  return hit?.title ?? mode;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function Record() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    const res = await api.getUserSessions(user.id, { limit: 40 });
    if (res.success && res.data) {
      setSessions(res.data as Session[]);
    } else {
      setError(res.error || '목록을 불러오지 못했습니다');
      setSessions([]);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '120px' }}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
            기록
          </h1>
          <button
            type="button"
            className="text-sm font-semibold"
            style={{ color: '#AAED10' }}
            onClick={() => void load()}
          >
            새로고침
          </button>
        </div>

        {loading ? (
          <p className="text-center py-16" style={{ color: '#888' }}>
            불러오는 중…
          </p>
        ) : error ? (
          <p className="text-center py-12 text-sm" style={{ color: '#c66' }}>
            {error}
          </p>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 px-4">
            <p className="text-sm mb-4" style={{ color: '#888' }}>
              아직 저장된 세션이 없습니다.
            </p>
            <button
              type="button"
              className="py-3 px-6 rounded-2xl font-bold text-sm"
              style={{ backgroundColor: '#AAED10', color: '#000' }}
              onClick={() => navigate('/training')}
            >
              트레이닝 시작
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {sessions.map((s) => (
              <motion.li
                key={s.id}
                layout
                className="rounded-2xl p-4 border"
                style={{ backgroundColor: '#1A1A1A', borderColor: '#2a2a2a' }}
              >
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <p className="font-bold" style={{ color: '#fff' }}>
                      {modeTitle(s.mode)}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#666' }}>
                      {formatWhen(s.createdAt)}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2 text-[11px]" style={{ color: '#777' }}>
                      {s.isComposite ? (
                        <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: '#222' }}>
                          종합
                        </span>
                      ) : null}
                      {s.isValid === false ? (
                        <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: '#2a1818' }}>
                          유효 제외
                        </span>
                      ) : null}
                      <span>BPM {s.bpm}</span>
                      <span>Lv {s.level}</span>
                      <span>{Math.round((s.duration || 0) / 1000)}초</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {typeof s.score === 'number' ? (
                      <span className="text-xl font-extrabold" style={{ color: '#AAED10' }}>
                        {s.score}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: '#555' }}>
                        —
                      </span>
                    )}
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-center mt-8 leading-relaxed" style={{ color: '#444' }}>
          종합 리포트·랭킹은 서버에 반영된 유효 세션을 기준으로 집계됩니다.
        </p>
      </div>
    </MobileLayout>
  );
}
