import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { MOCK_MEMBERS, getMockMemberTotalScore, type MockMember } from '../utils/mockMembers';
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

// 기업 내 랭킹 — 회원 관리(MOCK_MEMBERS)와 동일한 인원/지표를 사용해 동적으로 산출.
// (TODO: 기업 회원 데이터가 서버에 들어오면 이 mock 도 실데이터로 교체)
// 동일 점수면 동률 처리(같은 등수). composite는 종합 점수, time은 streak에서 파생한
// 합계 트레이닝 횟수, streak는 연속 일수 그대로 사용.
function rankRows(items: { nickname: string; value: number }[]): Row[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const out: Row[] = [];
  let prevValue = Number.POSITIVE_INFINITY;
  let prevRank = 0;
  sorted.forEach((it, i) => {
    const rank = it.value === prevValue ? prevRank : i + 1;
    out.push({ rank, nickname: it.nickname, value: it.value });
    prevValue = it.value;
    prevRank = rank;
  });
  return out;
}

function buildOrgRowsFromMembers(members: MockMember[]): Record<TabKey, Row[]> {
  // 합계 시간(회): streak 기반 + 약간의 가산(연속 외 산발 트레이닝 가정)
  const timeItems = members.map((m) => ({
    nickname: m.name,
    value: m.streak * 3 + (m.id.charCodeAt(m.id.length - 1) % 7) + 5,
  }));
  return {
    composite: rankRows(members.map((m) => ({ nickname: m.name, value: getMockMemberTotalScore(m) }))),
    time:      rankRows(timeItems),
    streak:    rankRows(members.map((m) => ({ nickname: m.name, value: m.streak }))),
  };
}

const ORG_ROWS: Record<TabKey, Row[]> = buildOrgRowsFromMembers(MOCK_MEMBERS);

/**
 * 기업 랭킹 — 서버 응답(실데이터) + MOCK_MEMBERS 더미 멤버를 합쳐 다시 등수 매김.
 * 더미 멤버는 OrganizationReport 의 "소속 인원 현황" 탭과 동일한 진실원이라
 * 리포트에는 보이지만 랭킹에는 빠지는 모순을 막는다.
 *
 * - 동일 닉네임은 서버 측을 우선 (실데이터 신뢰).
 * - 합쳐진 뒤 value 내림차순 정렬, 동점은 같은 등수.
 */
function mergeOrgRows(
  serverRows: Record<TabKey, Row[]>,
  mockRows: Record<TabKey, Row[]>,
): Record<TabKey, Row[]> {
  const out: Record<TabKey, Row[]> = { composite: [], time: [], streak: [] };
  (Object.keys(out) as TabKey[]).forEach((k) => {
    const seen = new Set(serverRows[k].map((r) => r.nickname));
    const extras = mockRows[k].filter((r) => !seen.has(r.nickname));
    const merged = [...serverRows[k], ...extras].sort((a, b) => b.value - a.value);
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
}

/**
 * "나의 랭킹" 카드의 4개 stat (종합·합계 시간·연속·출석률) + 등수.
 *
 * 과거: DEMO_PROFILE 하드코딩(80점/4시간/5일/90%) + user 테이블 캐시 필드를
 *       섞어 써서 "카드 ≠ 랭킹표" 가 동시에 보이는 모순이 생겼다.
 * 현재: 서버 `/api/rankings/user/:id/card` 한 곳에서 같은 14일 창 / 같은
 *       세션 데이터로 4개 모두 산출 → 카드와 랭킹표가 같은 진실원을 본다.
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

  // 서버 랭킹 — 실데이터 우선, 비어있으면 fallback
  const [serverRows, setServerRows] = useState<Record<TabKey, Row[]> | null>(null);
  // 카드 4개 stat — 서버 단일 진실원 (`/rankings/user/:id/card`)
  const [cardStats, setCardStats] = useState<CardStats>(EMPTY_CARD_STATS);
  const [myServerRank, setMyServerRank] = useState<Partial<Record<TabKey, number>>>({});
  const [cardLoaded, setCardLoaded] = useState(false);

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
              // TOTAL_TIME은 서버가 초 단위로 반환 → 화면 단위(시간)로 변환
              value:
                k === 'time'
                  ? Math.max(1, Math.round(e.score / 3600))
                  : Math.round(e.score),
            }));
          });
          // 기업 관리자: 더미 멤버(MOCK_MEMBERS)를 합쳐 다시 등수 매김.
          //   서버에 멤버가 실제 user 로 등록되지 않아도, 리포트와 동일한
          //   더미 로스터가 랭킹에서도 보이도록 일관성을 맞춘다.
          const merged = isOrgAdmin ? mergeOrgRows(out, ORG_ROWS) : out;
          // 어느 탭에라도 데이터가 있으면 (서버+더미) 합산값 사용
          const hasAny = merged.composite.length || merged.time.length || merged.streak.length;
          if (hasAny) setServerRows(merged);
        }

        if (user?.id) {
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
            setCardLoaded(true);
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
  // 등수 표시: 카드 응답이 없으면 "-" 로, 응답은 있는데 해당 탭에 등수가
  // 없으면 (= 14일 창에 유효 세션 0건) "-" 로 표기.
  const myRank = myServerRank[tab];
  const nickname = user?.name || user?.username || '홍길동';
  const myCardTitle = isOrgAdmin ? '기업 내 나의 랭킹' : '나의 랭킹';

  // 카드 4개 stat — 모두 서버 14일 창 단일 진실원에서 옴.
  // 종합 점수가 null 이면 "-" 표기 (세션 0건). 다른 stat 은 0 으로 자연 표기.
  const compositeDisplay = cardStats.compositeScore != null ? `${cardStats.compositeScore}점` : '-';
  const totalTimeDisplay = `${cardStats.totalTimeHours}${isOrgAdmin ? '회' : '시간'}`;
  const streakDisplay = `${cardStats.streakDays}일`;
  const attendanceDisplay = `${cardStats.attendanceRate}%`;
  const rankDisplay = myRank != null ? `${myRank}등` : (cardLoaded ? '-' : '…');

  return (
    <>
      {/* 상단 고정 헤더 — viewport에 직접 fixed.
          휴대폰 상태바(safe-area-inset-top) 보정 + 본문과 구분되는 보더. */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
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
          <h1 className="text-base font-bold" style={{ color: '#fff' }}>랭킹</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(48px + env(safe-area-inset-top) + 12px)', paddingBottom: '120px' }}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          {/* 나의 랭킹 섹션 타이틀 */}
          <h2 className="text-base font-bold text-white mb-2.5">{myCardTitle}</h2>
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
