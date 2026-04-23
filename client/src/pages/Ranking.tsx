import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { DEMO_PROFILE } from '../utils/demoProfile';
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

// =============================================================================
// 데모용 하드코딩 랭킹 데이터 (이미지 시안 기반)
// TODO: 실제 API(/rankings)로 교체
// =============================================================================

// 개인(전체) 랭킹
const PERSONAL_ROWS: Record<TabKey, Row[]> = {
  composite: [
    { rank: 1,  nickname: '마루',     value: 96 },
    { rank: 2,  nickname: '이선생',   value: 94 },
    { rank: 3,  nickname: '빛나는별', value: 93 },
    { rank: 4,  nickname: '플레임',   value: 92 },
    { rank: 5,  nickname: '천재칼치', value: 90 },
    { rank: 5,  nickname: '빛의전사', value: 90 },
    { rank: 7,  nickname: '죠니월드', value: 89 },
    { rank: 8,  nickname: '자둥',     value: 86 },
    { rank: 9,  nickname: '던',       value: 85 },
    { rank: 10, nickname: '단단무지', value: 85 },
  ],
  time: [
    { rank: 1,  nickname: '별빛소나타', value: 34 },
    { rank: 2,  nickname: '꽃잎비',     value: 31 },
    { rank: 3,  nickname: '엿따',       value: 28 },
    { rank: 4,  nickname: '이초홍',     value: 27 },
    { rank: 5,  nickname: '플레임',     value: 24 },
    { rank: 5,  nickname: '개복어',     value: 20 },
    { rank: 7,  nickname: '산들바람',   value: 19 },
    { rank: 8,  nickname: '칸데르니아', value: 17 },
    { rank: 9,  nickname: '푸른하늘',   value: 10 },
    { rank: 10, nickname: '달콤한꿈',   value: 8 },
  ],
  streak: [
    { rank: 1,  nickname: '꾸준한토끼', value: 42 },
    { rank: 2,  nickname: '매일매일',   value: 38 },
    { rank: 3,  nickname: '무쇠의지',   value: 35 },
    { rank: 4,  nickname: '뚜벅이',     value: 30 },
    { rank: 5,  nickname: '한결같이',   value: 27 },
    { rank: 6,  nickname: '쇠고집',     value: 24 },
    { rank: 7,  nickname: '루틴왕',     value: 21 },
    { rank: 8,  nickname: '빛나는별',   value: 18 },
    { rank: 9,  nickname: '하루하루',   value: 14 },
    { rank: 10, nickname: '뚝심이',     value: 12 },
  ],
};

// 기업 내 랭킹 — 시드된 데모 기업 12명 + 관리자 본인(13위)과 일치
const ORG_ROWS: Record<TabKey, Row[]> = {
  composite: [
    { rank: 1,  nickname: '박정수', value: 96 },
    { rank: 2,  nickname: '한봉수', value: 94 },
    { rank: 3,  nickname: '송상철', value: 93 },
    { rank: 4,  nickname: '김순자', value: 91 },
    { rank: 5,  nickname: '정복례', value: 89 },
    { rank: 6,  nickname: '윤덕수', value: 88 },
    { rank: 7,  nickname: '신옥자', value: 86 },
    { rank: 8,  nickname: '최말순', value: 84 },
    { rank: 9,  nickname: '오금자', value: 82 },
    { rank: 10, nickname: '이영희', value: 80 },
    { rank: 11, nickname: '임순녀', value: 78 },
    { rank: 12, nickname: '강만수', value: 76 },
  ],
  time: [
    { rank: 1,  nickname: '한봉수', value: 32 },
    { rank: 2,  nickname: '박정수', value: 28 },
    { rank: 3,  nickname: '송상철', value: 26 },
    { rank: 4,  nickname: '정복례', value: 24 },
    { rank: 5,  nickname: '김순자', value: 22 },
    { rank: 6,  nickname: '윤덕수', value: 20 },
    { rank: 7,  nickname: '신옥자', value: 18 },
    { rank: 8,  nickname: '최말순', value: 16 },
    { rank: 9,  nickname: '이영희', value: 14 },
    { rank: 10, nickname: '오금자', value: 12 },
    { rank: 11, nickname: '임순녀', value: 9  },
    { rank: 12, nickname: '강만수', value: 7  },
  ],
  streak: [
    { rank: 1,  nickname: '한봉수', value: 9 },
    { rank: 2,  nickname: '박정수', value: 8 },
    { rank: 3,  nickname: '송상철', value: 7 },
    { rank: 4,  nickname: '정복례', value: 6 },
    { rank: 5,  nickname: '김순자', value: 5 },
    { rank: 5,  nickname: '윤덕수', value: 5 },
    { rank: 7,  nickname: '신옥자', value: 4 },
    { rank: 8,  nickname: '이영희', value: 3 },
    { rank: 9,  nickname: '최말순', value: 2 },
    { rank: 9,  nickname: '오금자', value: 2 },
    { rank: 11, nickname: '강만수', value: 1 },
    { rank: 11, nickname: '임순녀', value: 1 },
  ],
};

// 내 랭킹 통계 — 단일 데모 프로필(DEMO_PROFILE)에서 가져와 다른 화면과 일치시킴
const PERSONAL_MY_RANK = {
  rankByTab: DEMO_PROFILE.rankByTab as Record<TabKey, number>,
  composite: DEMO_PROFILE.brainIndex,
  totalTime: DEMO_PROFILE.totalTimeHours,
  streakDays: DEMO_PROFILE.streakDays,
  attendanceRate: DEMO_PROFILE.attendanceRate,
  totalTimeUnit: '시간',
};
const ORG_MY_RANK = {
  // 관리자 본인은 시드 12명 뒤(13위)
  rankByTab: { composite: 13, time: 13, streak: 13 } as Record<TabKey, number>,
  composite: 75,
  totalTime: 5,
  streakDays: 0,
  attendanceRate: DEMO_PROFILE.attendanceRate,
  totalTimeUnit: '회',
};

const VISIBLE_DEFAULT = 10;
const PAGE_SIZE = 10;

// =============================================================================
// 데모 데이터 확장: 무한 스크롤 시연을 위해 11위 이하 가짜 데이터를 자동 생성
// TODO: 실제 API(/rankings?cursor=…)로 교체. 서버 페이지네이션 도입 시 useInfiniteQuery로 대체
// =============================================================================
const FILLER_NICKS_PERSONAL = [
  '구름빵', '솔솔바람', '단단무지', '한입콜라', '청량한봄', '느긋한곰', '자유로운새', '하늘빛', '잔잔호수', '눈송이',
  '햇살가득', '별이반짝', '달빛산책', '꽃향기', '바람결', '숲속요정', '파도소리', '노을빛', '새벽이슬', '첫눈',
  '향기로운차', '따스한손', '맑은물결', '두근두근', '도전왕', '기록깨기', '꾸준함', '집념의불꽃', '근면성실', '뇌지컬왕',
  '성장중', '한걸음씩', '레벨업', '지구력만렙', '뉴런폭주', '도파민러', '몰입러', '리듬타기', '뚝딱이', '고요한밤',
];
const FILLER_NICKS_ORG = [
  '강민수', '윤서아', '백도훈', '서지원', '양하린', '문채영', '신유찬', '조은서', '권태민', '송나윤',
  '배도현', '홍서윤', '안지호', '유리아', '임건우', '전소율', '황민준', '나예린', '곽시우', '주하윤',
  '구도윤', '명승현', '여승아', '성우진', '진예원', '하도경', '엄지안', '현우석', '태수영', '연지호',
];

function generateFillerRows(seedRows: Row[], nicks: string[], lastValue: number): Row[] {
  const out: Row[] = [];
  let prevVal = lastValue;
  let rank = (seedRows[seedRows.length - 1]?.rank ?? 10) + 1;
  for (let i = 0; i < nicks.length; i++) {
    // 값은 자연스럽게 감소 (랭킹 하위로 갈수록 점수↓)
    const drop = Math.max(1, Math.round((i % 3) + 1));
    const v = Math.max(1, prevVal - drop);
    out.push({ rank, nickname: nicks[i], value: v });
    prevVal = v;
    rank += 1;
  }
  return out;
}

function buildFullDataset(
  base: Record<TabKey, Row[]>,
  nicks: string[],
): Record<TabKey, Row[]> {
  return {
    composite: [...base.composite, ...generateFillerRows(base.composite, nicks, base.composite[base.composite.length - 1].value)],
    time:      [...base.time,      ...generateFillerRows(base.time,      nicks, base.time[base.time.length - 1].value)],
    streak:    [...base.streak,    ...generateFillerRows(base.streak,    nicks, base.streak[base.streak.length - 1].value)],
  };
}

const PERSONAL_ROWS_FULL = buildFullDataset(PERSONAL_ROWS, FILLER_NICKS_PERSONAL);
const ORG_ROWS_FULL      = buildFullDataset(ORG_ROWS,      FILLER_NICKS_ORG);

export default function Ranking() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('composite');
  const [visible, setVisible] = useState(VISIBLE_DEFAULT);

  // 기업 관리자 계정만 기업 내 랭킹 열람 가능.
  // 기업 소속 개인은 일반 개인 랭킹(전체)만 볼 수 있음.
  const isOrgAdmin = user?.userType === 'ORGANIZATION';
  const fallbackDataset = isOrgAdmin ? ORG_ROWS_FULL : PERSONAL_ROWS_FULL;
  const myStats = isOrgAdmin ? ORG_MY_RANK : PERSONAL_MY_RANK;

  // 서버 랭킹 — 실데이터 우선, 비어있으면 fallback
  const [serverRows, setServerRows] = useState<Record<TabKey, Row[]> | null>(null);
  const [myServerRank, setMyServerRank] = useState<Partial<Record<TabKey, number>>>({});

  useEffect(() => {
    let cancelled = false;
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
              value: Math.round(e.score),
            }));
          });
          // 어느 탭에라도 데이터가 있으면 서버값 사용
          const hasAny = out.composite.length || out.time.length || out.streak.length;
          if (hasAny) setServerRows(out);
        }

        if (user?.id) {
          const meRes = await api.get<RankingEntry[]>(`/rankings/user/${user.id}`);
          if (!cancelled && meRes.success && meRes.data) {
            const map: Partial<Record<TabKey, number>> = {};
            for (const e of meRes.data) {
              const tab = (Object.keys(TAB_TO_TYPE) as TabKey[]).find(
                (k) => TAB_TO_TYPE[k] === e.rankingType,
              );
              if (tab) map[tab] = e.rank;
            }
            setMyServerRank(map);
          }
        }
      } catch (e) {
        console.error('랭킹 로드 실패:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOrgAdmin, user?.id, user?.organizationId]);

  const dataset: Record<TabKey, Row[]> = useMemo(() => {
    if (!serverRows) return fallbackDataset;
    // 탭별로 서버 데이터가 비었으면 fallback 사용
    return {
      composite: serverRows.composite.length > 0 ? serverRows.composite : fallbackDataset.composite,
      time: serverRows.time.length > 0 ? serverRows.time : fallbackDataset.time,
      streak: serverRows.streak.length > 0 ? serverRows.streak : fallbackDataset.streak,
    };
  }, [serverRows, fallbackDataset]);

  const rows = useMemo(() => dataset[tab], [dataset, tab]);
  const suffix = TABS.find((t) => t.id === tab)!.suffix;
  const myRank = myServerRank[tab] ?? myStats.rankByTab[tab];
  const nickname = user?.name || user?.username || '홍길동';
  const myCardTitle = isOrgAdmin ? '기업 내 나의 랭킹' : '나의 랭킹';

  // 실제 로그인 사용자 데이터로 통계 카드 보강
  const liveStreak = user?.streak ?? myStats.streakDays;
  const liveComposite = user?.brainAge ?? myStats.composite;

  return (
    <>
      {/* 통일 헤더 — paddingTop으로 노치/상단바 안전영역 자체 보정 */}
      <header
        className="sticky top-0 z-40"
        style={{
          backgroundColor: '#0A0A0A',
          borderBottom: '1px solid #1A1A1A',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="max-w-md mx-auto px-4 h-12 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-white"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <rect x="4" y="12" width="3.5" height="8" rx="1" />
            <rect x="10.25" y="7" width="3.5" height="13" rx="1" />
            <rect x="16.5" y="3" width="3.5" height="17" rx="1" />
          </svg>
          <h1 className="text-base font-bold" style={{ color: '#fff' }}>{myCardTitle}</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-4 pb-6" style={{ paddingBottom: '120px' }}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          {/* 나의 랭킹 카드 */}
          <div
            className="rounded-2xl p-4 mb-5"
            style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
          >
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
                {myRank}등
              </span>
            </div>

            <div className="h-px mb-3" style={{ backgroundColor: '#2a2a2a' }} />

            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <Stat label="종합트레이닝" value={`${liveComposite}점`} />
              <Stat label="합계 시간"    value={`${myStats.totalTime}${myStats.totalTimeUnit}`} />
              <Stat label="연속 트레이닝" value={`${liveStreak}일`} />
              <Stat label="출석률"       value={`${myStats.attendanceRate}%`} />
            </div>
          </div>

          {/* 탭 */}
          <div
            className="flex p-1 rounded-full mb-4"
            style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
          >
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

          {/* 리스트 */}
          <ul
            className="rounded-2xl overflow-hidden"
            style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
          >
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

          {/* 무한 스크롤 sentinel */}
          <InfiniteSentinel
            hasMore={visible < rows.length}
            onLoadMore={() => setVisible((v) => Math.min(v + PAGE_SIZE, rows.length))}
          />
          {visible >= rows.length && rows.length > VISIBLE_DEFAULT && (
            <p className="w-full mt-4 text-center text-xs" style={{ color: '#555' }}>
              마지막 순위까지 모두 표시되었습니다
            </p>
          )}
        </motion.div>
      </div>
    </>
  );
}

// IntersectionObserver 기반 무한 스크롤 트리거
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
