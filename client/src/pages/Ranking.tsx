import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { RankingEntry, RankingType } from '@noilink/shared';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';

const TABS: { id: RankingType; label: string; unit: string }[] = [
  { id: 'COMPOSITE_SCORE', label: '종합 점수', unit: '점 (가중·상위3 평균)' },
  { id: 'TOTAL_TIME', label: '합계 시간', unit: '초 (14일)' },
  { id: 'STREAK', label: '스트릭', unit: '일 (14일 내 최대 연속)' },
];

/**
 * 랭킹 탭 — 명세 5장: 3종 고정, 기관 소속 시 기관 필터
 */
export default function Ranking() {
  const { user } = useAuth();
  const [tab, setTab] = useState<RankingType>('COMPOSITE_SCORE');
  const [rows, setRows] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      const res = await api.getRankings(undefined, 50, user?.organizationId);
      if (cancelled) return;
      if (!res.success || !res.data) {
        setErr(res.error || '랭킹을 불러오지 못했습니다.');
        setRows([]);
      } else {
        const list = res.data[tab] || [];
        setRows(list);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, user?.organizationId]);

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-6" style={{ paddingBottom: '120px' }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
          <h1 className="text-2xl font-bold mb-1" style={{ color: '#fff' }}>
            랭킹
          </h1>
          <p className="text-xs mb-4" style={{ color: '#888' }}>
            최근 14일 · 종합 점수는 일 최대 2회만 반영 후 상위 3회 평균
            {user?.organizationId ? ' · 기관 소속 기준' : ' · 전체'}
          </p>

          <div className="flex gap-2 mb-4 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="px-3 py-1.5 rounded-full text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: tab === t.id ? '#AAED10' : '#1A1A1A',
                  color: tab === t.id ? '#000' : '#ccc',
                  border: tab === t.id ? 'none' : '1px solid #333',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading && <p style={{ color: '#888' }}>불러오는 중…</p>}
          {err && <p style={{ color: '#f87171' }}>{err}</p>}

          {!loading && !err && (
            <>
              <p className="text-[11px] mb-2" style={{ color: '#666' }}>
                {TABS.find((x) => x.id === tab)?.unit}
              </p>
              <ul className="space-y-2">
                {rows.length === 0 && (
                  <li className="text-sm" style={{ color: '#888' }}>
                    아직 집계할 기록이 없습니다.
                  </li>
                )}
                {rows.map((r) => (
                  <li
                    key={`${r.rankingType}-${r.userId}-${r.rank}`}
                    className="flex items-center justify-between rounded-xl px-3 py-3"
                    style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-8 text-center font-bold shrink-0"
                        style={{ color: r.rank <= 3 ? '#AAED10' : '#888' }}
                      >
                        {r.rank}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{r.username}</div>
                        <div className="text-[11px] truncate" style={{ color: '#666' }}>
                          {r.userType === 'ORGANIZATION' ? '기관' : '개인'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold" style={{ color: '#fff' }}>
                        {r.score}
                      </div>
                      {typeof r.metadata?.sessionCount === 'number' && (
                        <div className="text-[10px]" style={{ color: '#666' }}>
                          세션 {r.metadata.sessionCount}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </motion.div>
      </div>
    </MobileLayout>
  );
}
