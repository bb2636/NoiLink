import { useEffect, useState } from 'react';
import {
  shouldShowRecoveryCoaching,
  type AggregatedRecoveryStats,
} from '@noilink/shared';
import {
  clearDismissed as clearRecoveryCoachingDismissed,
  readDismissed as readRecoveryCoachingDismissed,
  writeDismissed as writeRecoveryCoachingDismissed,
} from '../utils/recoveryCoachingDismissal';

// -----------------------------------------------------------------------------
// 재연결 회복 통계·코칭(Task #37)
// -----------------------------------------------------------------------------
// - 한 번이라도 회복 구간이 있었던 사용자에게 누적 시간/회수를 가볍게 보여주고,
// - 최근 N개 세션의 세션당 평균 회복 시간이 30초 이상이면 "환경 점검" 카드를
//   띄운다(트리거 = 카드 카피와 1:1 일치). 단발성 outlier 만으로는 띄우지 않는다.
// 회복이 한 번도 없었던 경우엔 카드를 통째로 숨겨 잡음을 만들지 않는다.
export function RecoverySection({
  stats,
  userId,
}: {
  stats: AggregatedRecoveryStats;
  userId: string | null;
}) {
  const showCoaching = shouldShowRecoveryCoaching(stats);

  // 사용자가 안내를 닫을 수 있도록 하되(과도한 잔소리 방지),
  // 닫힘 상태를 사용자별로 영속화해 다음 페이지 진입에서도 같은 트립 동안에는
  // 다시 노출되지 않도록 한다(Task #74). 신호가 임계 미만으로 내려가면(=트립 종료)
  // 닫힘 기억을 자동으로 비워, 다음에 다시 임계를 넘으면 새 안내로 다시 등장한다.
  //
  // Hooks 규칙(early return 보다 위에서 무조건 호출) 준수 — 회복이
  // 한 번도 없던 상태와 있는 상태가 오가도 호출 순서가 깨지지 않는다.
  // userId 가 바뀌면(다른 계정 로그인) 해당 사용자의 저장값으로 다시 동기화한다.
  const [coachingDismissed, setCoachingDismissed] = useState<boolean>(() =>
    readRecoveryCoachingDismissed(userId),
  );
  useEffect(() => {
    setCoachingDismissed(readRecoveryCoachingDismissed(userId));
  }, [userId]);
  useEffect(() => {
    if (!showCoaching) {
      // 트립이 끝났다 — 다음 트립에선 새 안내로 떠야 하므로 기억을 비운다.
      clearRecoveryCoachingDismissed(userId);
      setCoachingDismissed(false);
    }
  }, [showCoaching, userId]);

  const handleDismiss = () => {
    setCoachingDismissed(true);
    writeRecoveryCoachingDismissed(userId);
  };

  // 회복이 한 번도 없었던 사용자에게는 카드를 노출하지 않는다 — 잡음 방지.
  if (stats.sessionsWithRecovery === 0) return null;
  const totalSec = Math.round(stats.totalMs / 1000);
  const avgSec = Math.round(stats.avgMsPerSession / 1000);

  return (
    <div className="mb-6">
      <h2 className="text-white text-base font-semibold mb-3">기기 연결 안정성</h2>
      <div className="rounded-2xl p-4" style={{ backgroundColor: '#1A1A1A' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-gray-400 text-xs mb-1">최근 세션 누적 회복 시간</div>
            <div className="flex items-baseline gap-1">
              <span className="text-white text-2xl font-bold">{totalSec}</span>
              <span className="text-gray-300 text-sm">초</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-gray-400 text-xs mb-1">회복 구간</div>
            <div className="flex items-baseline gap-1 justify-end">
              <span className="text-white text-2xl font-bold">{stats.windowsTotal}</span>
              <span className="text-gray-300 text-sm">회</span>
            </div>
          </div>
        </div>
        <div className="text-gray-500 text-[11px]">
          최근 {stats.sessionsCount}개 세션 중 {stats.sessionsWithRecovery}개에서
          회복 발생 · 세션당 평균 ≈ {avgSec}초
        </div>

        {showCoaching && !coachingDismissed && (
          <div
            role="status"
            data-testid="recovery-coaching-card"
            className="mt-3 rounded-xl px-3 py-3 relative"
            style={{
              backgroundColor: '#3A2A00',
              color: '#FFD66B',
              border: '1px solid #5A4500',
            }}
          >
            <button
              type="button"
              aria-label="안내 닫기"
              data-testid="recovery-coaching-dismiss"
              onClick={handleDismiss}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-base leading-none"
              style={{ color: '#F5E0A0', backgroundColor: 'transparent' }}
            >
              ×
            </button>
            <div className="text-sm font-semibold mb-1 pr-6">환경 점검을 권장해요</div>
            <p className="text-[12px] leading-relaxed pr-6" style={{ color: '#F5E0A0' }}>
              최근 {stats.sessionsCount}개 세션의 평균 회복 시간이 30초를 넘었어요.
              기기와의 거리를 줄이거나 주변 블루투스 간섭(전자레인지·공유기 등)을
              확인하면 점수에 반영되는 시간이 늘어납니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
