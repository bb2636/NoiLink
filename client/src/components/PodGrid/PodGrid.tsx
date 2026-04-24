/**
 * 가상 Pod 4개 그리드 (2×2 배치)
 *
 * - 색상에 따라 글로우 효과
 * - 탭 핸들러
 * - 트레이닝 엔진의 PodState 배열을 그대로 받아 시각화
 *
 * 시각 보강(빠른 BPM 박자 가독성):
 *   엔진의 RHYTHM Lv4/Lv5 점등은 박의 40%로 짧다(BPM 180에서 ~120ms).
 *   각 점등(=새 tickId) 직후, pointer-events:none 인 잔상(after-glow) 레이어와
 *   둘레 펄스 링을 ~420~520ms 동안 재생해 박자감을 살린다.
 *   - 잔상은 onPodStates의 tickId 변화로만 트리거되고
 *   - 입력 판정(handleTap/handleRhythmTap)에는 영향이 없으며
 *   - 점등이 끝나도(isTarget=false, fill=OFF) 잔상 애니메이션은 계속 fade-out 한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { PodState, PodFill } from '../../training/engine';

const COLOR_MAP: Record<PodFill, { bg: string; glow: string; label: string }> = {
  OFF:    { bg: '#1A1A1A', glow: 'transparent',         label: '' },
  GREEN:  { bg: '#22C55E', glow: 'rgba(34,197,94,0.7)',  label: '초록' },
  RED:    { bg: '#EF4444', glow: 'rgba(239,68,68,0.7)',  label: '빨강' },
  BLUE:   { bg: '#3B82F6', glow: 'rgba(59,130,246,0.7)', label: '파랑' },
  YELLOW: { bg: '#FACC15', glow: 'rgba(250,204,21,0.7)', label: '노랑' },
  WHITE:  { bg: '#FFFFFF', glow: 'rgba(255,255,255,0.7)', label: '흰색' },
};

/** 잔상에 사용할 색상 추출 — OFF는 투명 처리 */
function glowBgFor(color: PodFill): string {
  if (color === 'OFF') return 'transparent';
  // 잔상은 같은 색이지만 약간 투명도를 더해 부드럽게 잔향 — RGBA 0.45.
  switch (color) {
    case 'GREEN':  return 'rgba(34,197,94,0.45)';
    case 'RED':    return 'rgba(239,68,68,0.45)';
    case 'BLUE':   return 'rgba(59,130,246,0.45)';
    case 'YELLOW': return 'rgba(250,204,21,0.55)';
    case 'WHITE':  return 'rgba(255,255,255,0.55)';
    default:       return 'transparent';
  }
}

interface PodCellProps {
  pod: PodState;
  onTap: (podId: number) => void;
}

function PodCell({ pod, onTap }: PodCellProps) {
  const cm = COLOR_MAP[pod.fill];
  const isLit = pod.fill !== 'OFF';

  /**
   * 점등 이벤트 캡처 — 새 tickId 가 부여될 때마다 잔상/링 애니메이션을 재생.
   * 잔상은 OFF 전환 후에도 fade-out 이 진행되도록 별도 상태로 보존한다.
   *
   * 주의: tickId 는 0(OFF) → 새 값(점등) → 0(OFF) 순으로 변하기 때문에,
   * 0 으로 가는 전환은 무시하고 0 이상의 새 값일 때만 잔상을 트리거한다.
   */
  const [glow, setGlow] = useState<{ id: number; color: PodFill } | null>(null);
  const lastTickIdRef = useRef(0);
  useEffect(() => {
    if (pod.tickId > 0 && pod.tickId !== lastTickIdRef.current) {
      lastTickIdRef.current = pod.tickId;
      setGlow({ id: pod.tickId, color: pod.fill });
    }
  }, [pod.tickId, pod.fill]);

  const glowColor = glow ? glowBgFor(glow.color) : 'transparent';
  const glowShadow = glow ? COLOR_MAP[glow.color].glow : 'transparent';

  return (
    <div className="relative aspect-square">
      {/* 둘레 펄스 링 — 박자 마커. 점등 시작과 동시에 발생, 점등이 짧아도 ~520ms 동안 펄스. */}
      {glow && (
        <span
          key={`ring-${glow.id}`}
          className="pod-beat-ring"
          style={{
            ['--pod-glow-shadow' as string]: glowShadow,
          } as React.CSSProperties}
          aria-hidden
        />
      )}

      <button
        type="button"
        onClick={() => onTap(pod.id)}
        className="relative w-full h-full rounded-full border-2 transition-all active:scale-95 overflow-hidden"
        style={{
          backgroundColor: cm.bg,
          borderColor: isLit ? '#fff' : '#2A2A2A',
          boxShadow: isLit ? `0 0 28px 4px ${cm.glow}` : 'none',
        }}
        aria-label={`Pod ${pod.id + 1} ${cm.label}`}
      >
        {/* 색상 잔상(after-glow) — 점등이 끝나도 ~420ms 동안 fade-out 으로 박자감 보강. */}
        {glow && (
          <span
            key={`glow-${glow.id}`}
            className="pod-afterglow"
            style={{
              ['--pod-glow-color' as string]: glowColor,
              ['--pod-glow-shadow' as string]: glowShadow,
            } as React.CSSProperties}
            aria-hidden
          />
        )}
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
          style={{ color: isLit && pod.fill !== 'WHITE' && pod.fill !== 'YELLOW' ? '#fff' : '#1A1A1A' }}
        >
          P{pod.id}
        </span>
      </button>
    </div>
  );
}

export default function PodGrid({
  pods,
  onTap,
}: {
  pods: PodState[];
  onTap: (podId: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
      {pods.map((p) => (
        <PodCell key={p.id} pod={p} onTap={onTap} />
      ))}
    </div>
  );
}
