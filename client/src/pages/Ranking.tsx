import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';

type TabKey = 'composite' | 'time' | 'streak';

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
const MOCK_ROWS: Record<TabKey, Row[]> = {
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

// 내 랭킹 (이미지 시안)
const MY_RANK = {
  rankByTab: { composite: 13, time: 27, streak: 19 } as Record<TabKey, number>,
  composite: 82,
  totalHours: 4,
  streakDays: 5,
  attendanceRate: 90,
};

const VISIBLE_DEFAULT = 10;

export default function Ranking() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('composite');
  const [visible, setVisible] = useState(VISIBLE_DEFAULT);

  const rows = useMemo(() => MOCK_ROWS[tab], [tab]);
  const suffix = TABS.find((t) => t.id === tab)!.suffix;
  const myRank = MY_RANK.rankByTab[tab];
  const nickname = user?.name || user?.username || '홍길동';

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-6" style={{ paddingBottom: '120px' }}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          {/* 헤더 */}
          <h1 className="text-xl font-bold mb-5 flex items-center gap-2" style={{ color: '#fff' }}>
            <span style={{ color: '#AAED10' }}>📊</span> 랭킹
          </h1>

          {/* 나의 랭킹 카드 */}
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#ddd' }}>나의 랭킹</h2>
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
              <Stat label="종합트레이닝" value={`${MY_RANK.composite}점`} />
              <Stat label="합계 시간"    value={`${MY_RANK.totalHours}시간`} />
              <Stat label="연속 트레이닝" value={`${MY_RANK.streakDays}일`} />
              <Stat label="출석률"       value={`${MY_RANK.attendanceRate}%`} />
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

          {/* 더보기 */}
          {visible < rows.length ? (
            <button
              type="button"
              onClick={() => setVisible((v) => v + 10)}
              className="w-full mt-4 flex flex-col items-center gap-0.5 text-sm"
              style={{ color: '#999' }}
            >
              더보기
              <span style={{ fontSize: 14, lineHeight: 1 }}>⌄</span>
            </button>
          ) : (
            <div className="w-full mt-4 flex flex-col items-center gap-0.5 text-sm" style={{ color: '#555' }}>
              더보기
              <span style={{ fontSize: 14, lineHeight: 1 }}>⌄</span>
            </div>
          )}
        </motion.div>
      </div>
    </MobileLayout>
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
