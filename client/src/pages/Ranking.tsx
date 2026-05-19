import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import type { RankingEntry, RankingType } from '@noilink/shared';

type TabKey = 'composite' | 'time' | 'streak';

const TAB_TO_TYPE: Record<TabKey, RankingType> = {
  composite: 'COMPOSITE_SCORE',
  time: 'TOTAL_TIME',
  streak: 'STREAK',
};

interface Row {
  rank: number;
  nickname: string;
  value: number;
}

const TABS: { id: TabKey; label: string; suffix: string }[] = [
  { id: 'composite', label: '종합 트레이닝', suffix: '점' },
  { id: 'time',      label: '합계 시간',     suffix: '시간' },
  { id: 'streak',    label: '연속 트레이닝', suffix: '일' },
];

/**
 * "나의 랭킹" 카드의 4개 stat (종합·합계 시간·연속·출석률) + 등수.
 * 서버 `/api/rankings/user/:id/card` 단일 진실원에서 14일 창 기준으로 산출.
 */
type CardStats = {
  compositeScore: number | null;
  totalTimeHours: number;
  streakDays: number;
  attendanceRate: number;
};
const EMPTY_CARD_STATS: CardStats = {
  compositeScore: null,
  totalTimeHours: 0,
  streakDays: 0,
  attendanceRate: 0,
};

const VISIBLE_DEFAULT = 10;
const PAGE_SIZE = 10;

const EMPTY_ROWS: Record<TabKey, Row[]> = { composite: [], time: [], streak: [] };

export default function Ranking() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('composite');
  const [visible, setVisible] = useState(VISIBLE_DEFAULT);

  const isOrgAdmin = user?.userType === 'ORGANIZATION';

  // 서버 랭킹 데이터. null = 아직 로딩 중, {} = 응답 도착 (빈 결과 포함).
  // 과거 mock fallback(PERSONAL_ROWS / ORG_ROWS / FILLER_NICKS)을 두면
  // 응답 전에는 가짜 목록이, 응답 후에는 빈 상태가 보이는 깜빡임이 생겨 제거.
  const [serverRows, setServerRows] = useState<Record<TabKey, Row[]> | null>(null);
  const [cardStats, setCardStats] = useState<CardStats>(EMPTY_CARD_STATS);
  const [myServerRank, setMyServerRank] = useState<Partial<Record<TabKey, number>>>({});
  const [cardLoaded, setCardLoaded] = useState(false);
  const [rowsLoaded, setRowsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRowsLoaded(false);
    setCardLoaded(false);
    (async () => {
      try {
        const orgId = isOrgAdmin ? user?.organizationId ?? user?.id : undefined;
        const res = await api.getRankings(undefined, 100, orgId);
        if (!cancelled && res.success && res.data) {
          const grouped = res.data as Record<string, RankingEntry[]>;
          const out: Record<TabKey, Row[]> = { composite: [], time: [], streak: [] };
          (Object.keys(TAB_TO_TYPE) as TabKey[]).forEach((k) => {
            const list = grouped[TAB_TO_TYPE[k]] ?? [];
            out[k] = list.map((e) => ({
              rank: e.rank,
              nickname: e.username || '익명',
              // TOTAL_TIME은 서버가 초 단위로 반환 → 화면 단위(시간)로 변환
              value:
                k === 'time'
                  ? Math.max(1, Math.round(e.score / 3600))
                  : Math.round(e.score),
            }));
          });
          setServerRows(out);
        } else if (!cancelled) {
          setServerRows(EMPTY_ROWS);
        }

        if (user?.id) {
          try {
            const cardRes = await api.getMyRankingCard(user.id);
            if (!cancelled && cardRes.success && cardRes.data) {
              setCardStats({
                compositeScore: cardRes.data.compositeScore,
                totalTimeHours: cardRes.data.totalTimeHours,
                streakDays: cardRes.data.streakDays,
                attendanceRate: cardRes.data.attendanceRate,
              });
              setMyServerRank({
                composite: cardRes.data.myRanks.composite,
                time: cardRes.data.myRanks.time,
                streak: cardRes.data.myRanks.streak,
              });
            }
          } finally {
            // 카드 API 가 실패해도 cardLoaded 는 true 로 마감해야 한다. 그렇지
            // 않으면 등수 표시가 영구히 '…' 로 남고, dataset useMemo 의 본인
            // inject 가 비활성화되어 "본인이 목록에 안 나옴" 회귀가 다시 생긴다.
            if (!cancelled) setCardLoaded(true);
          }
        } else if (!cancelled) {
          setCardLoaded(true);
        }
      } catch (e) {
        console.error('랭킹 로드 실패:', e);
        if (!cancelled) {
          setServerRows(EMPTY_ROWS);
          setCardLoaded(true);
        }
      } finally {
        if (!cancelled) setRowsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOrgAdmin, user?.id, user?.organizationId]);

  const dataset: Record<TabKey, Row[]> = useMemo(() => {
    const base: Record<TabKey, Row[]> = serverRows ?? EMPTY_ROWS;

    // 본인이 목록에 없으면 카드 stats 기준으로 inject — 카드와 표가 같은 사람을
    // 보여 "내 등수=2등인데 표에는 내가 없다" 같은 모순을 막는다.
    const myName = user?.name || user?.username;
    if (!myName || !cardLoaded) return base;

    const myValueMap: Record<TabKey, number | null> = {
      composite: cardStats.compositeScore,
      time:      cardStats.totalTimeHours > 0 ? cardStats.totalTimeHours : null,
      streak:    cardStats.streakDays > 0 ? cardStats.streakDays : null,
    };

    const out: Record<TabKey, Row[]> = { composite: [], time: [], streak: [] };
    (Object.keys(out) as TabKey[]).forEach((k) => {
      const rowsK = base[k];
      const myValue = myValueMap[k];
      const alreadyIn = rowsK.some((r) => r.nickname === myName);
      if (alreadyIn || myValue == null) {
        out[k] = rowsK;
        return;
      }
      const merged = [...rowsK, { rank: 0, nickname: myName, value: myValue }]
        .sort((a, b) => b.value - a.value);
      let prevValue = Number.POSITIVE_INFINITY;
      let prevRank = 0;
      out[k] = merged.map((r, i) => {
        const rank = r.value === prevValue ? prevRank : i + 1;
        prevValue = r.value;
        prevRank = rank;
        return { rank, nickname: r.nickname, value: r.value };
      });
    });
    return out;
  }, [serverRows, user?.name, user?.username, cardStats, cardLoaded]);

  const rows = useMemo(() => dataset[tab], [dataset, tab]);
  const suffix = TABS.find((t) => t.id === tab)!.suffix;
  const myRank = myServerRank[tab];
  const nickname = user?.name || user?.username || '홍길동';
  const myCardTitle = isOrgAdmin ? '기업 내 나의 랭킹' : '나의 랭킹';

  const compositeDisplay = cardLoaded
    ? (cardStats.compositeScore != null ? `${cardStats.compositeScore}점` : '-')
    : '…';
  const totalTimeDisplay = cardLoaded ? `${cardStats.totalTimeHours}시간` : '…';
  const streakDisplay = cardLoaded ? `${cardStats.streakDays}일` : '…';
  const attendanceDisplay = cardLoaded ? `${cardStats.attendanceRate}%` : '…';
  const rankDisplay = myRank != null ? `${myRank}등` : (cardLoaded ? '-' : '…');

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          backgroundColor: '#0A0A0A',
          borderBottom: '1px solid #1A1A1A',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="max-w-md mx-auto px-4 h-12 flex items-center gap-2">
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="12" width="3.5" height="8" rx="1" />
            <rect x="10.25" y="7" width="3.5" height="13" rx="1" />
            <rect x="16.5" y="3" width="3.5" height="17" rx="1" />
          </svg>
          <h1 className="text-base font-bold" style={{ color: '#fff' }}>랭킹</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(48px + env(safe-area-inset-top) + 12px)', paddingBottom: '120px' }}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <h2 className="text-base font-bold text-white mb-2.5">{myCardTitle}</h2>
          <div className="rounded-2xl p-4 mb-5" style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                  style={{ backgroundColor: '#2a2a2a', color: '#AAED10' }}
                >
                  {nickname.slice(0, 1)}
                </div>
                <span className="text-white font-semibold truncate">{nickname} 님</span>
              </div>
              <span
                className="px-3 py-1 rounded-full text-xs font-bold shrink-0"
                style={{ backgroundColor: '#2a3a14', color: '#AAED10', border: '1px solid #3d5a1c' }}
              >
                {rankDisplay}
              </span>
            </div>

            <div className="h-px mb-3" style={{ backgroundColor: '#2a2a2a' }} />

            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <Stat label="종합트레이닝" value={compositeDisplay} />
              <Stat label="합계 시간"    value={totalTimeDisplay} />
              <Stat label="연속 트레이닝" value={streakDisplay} />
              <Stat label="출석률"       value={attendanceDisplay} />
            </div>
          </div>

          <div className="flex p-1 rounded-full mb-4" style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}>
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTab(t.id); setVisible(VISIBLE_DEFAULT); }}
                  className="flex-1 py-2 rounded-full text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: active ? '#AAED10' : 'transparent',
                    color: active ? '#000' : '#bbb',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* 리스트 — 로딩/빈 상태 명시 분기로 mock 깜빡임 제거 */}
          {!rowsLoaded ? (
            <div className="rounded-2xl py-10 flex flex-col items-center gap-2"
                 style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a', color: '#666' }}>
              <span className="inline-block w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: '#AAED10', borderTopColor: 'transparent' }} />
              <span className="text-xs">랭킹을 불러오는 중…</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl py-10 px-4 text-center"
                 style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a', color: '#888' }}>
              <p className="text-sm">아직 랭킹에 표시할 기록이 없어요.</p>
              <p className="text-xs mt-1" style={{ color: '#666' }}>
                트레이닝을 시작하면 이 자리에 순위가 채워집니다.
              </p>
            </div>
          ) : (
            <ul className="rounded-2xl overflow-hidden"
                style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}>
              {rows.slice(0, visible).map((r, i) => (
                <li
                  key={`${r.rank}-${r.nickname}-${i}`}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid #232323' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                      style={{
                        backgroundColor: r.rank <= 3 ? '#2a3a14' : '#2a2a2a',
                        color: r.rank <= 3 ? '#AAED10' : '#bbb',
                      }}
                    >
                      {r.rank}
                    </span>
                    <span className="text-white truncate">{r.nickname}</span>
                  </div>
                  <span className="font-bold shrink-0" style={{ color: '#fff' }}>
                    {r.value}{suffix}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {rowsLoaded && rows.length > 0 && (
            <>
              <InfiniteSentinel
                hasMore={visible < rows.length}
                onLoadMore={() => setVisible((v) => Math.min(v + PAGE_SIZE, rows.length))}
              />
              {visible >= rows.length && rows.length > VISIBLE_DEFAULT && (
                <p className="w-full mt-4 text-center text-xs" style={{ color: '#555' }}>
                  마지막 순위까지 모두 표시되었습니다
                </p>
              )}
            </>
          )}
        </motion.div>
      </div>
    </>
  );
}

function InfiniteSentinel({
  hasMore,
  onLoadMore,
}: {
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: '120px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  if (!hasMore) return null;

  return (
    <div ref={ref} className="w-full mt-4 flex flex-col items-center gap-1 text-sm" style={{ color: '#666' }}>
      <span
        className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: '#AAED10', borderTopColor: 'transparent' }}
      />
      <span className="text-xs">불러오는 중…</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: '#888' }}>{label}</span>
      <span className="font-bold text-white">{value}</span>
    </div>
  );
}
