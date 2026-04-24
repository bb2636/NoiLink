/**
 * 가상 Pod 4개 그리드 (2×2 배치)
 *
 * - 색상에 따라 글로우 효과
 * - 탭 핸들러
 * - 트레이닝 엔진의 PodState 배열을 그대로 받아 시각화
 */
import type { PodState, PodFill } from '../../training/engine';

const COLOR_MAP: Record<PodFill, { bg: string; glow: string; label: string }> = {
  OFF:    { bg: '#1A1A1A', glow: 'transparent',         label: '' },
  GREEN:  { bg: '#22C55E', glow: 'rgba(34,197,94,0.7)',  label: '초록' },
  RED:    { bg: '#EF4444', glow: 'rgba(239,68,68,0.7)',  label: '빨강' },
  BLUE:   { bg: '#3B82F6', glow: 'rgba(59,130,246,0.7)', label: '파랑' },
  YELLOW: { bg: '#FACC15', glow: 'rgba(250,204,21,0.7)', label: '노랑' },
  WHITE:  { bg: '#FFFFFF', glow: 'rgba(255,255,255,0.7)', label: '흰색' },
};

export default function PodGrid({
  pods,
  onTap,
}: {
  pods: PodState[];
  onTap: (podId: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
      {pods.map((p) => {
        const cm = COLOR_MAP[p.fill];
        const isLit = p.fill !== 'OFF';
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onTap(p.id)}
            className="relative aspect-square rounded-full border-2 transition-all active:scale-95"
            style={{
              backgroundColor: cm.bg,
              borderColor: isLit ? '#fff' : '#2A2A2A',
              boxShadow: isLit ? `0 0 28px 4px ${cm.glow}` : 'none',
            }}
            aria-label={`Pod ${p.id + 1} ${cm.label}`}
          >
            <span
              className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
              style={{ color: isLit && p.fill !== 'WHITE' && p.fill !== 'YELLOW' ? '#fff' : '#1A1A1A' }}
            >
              P{p.id}
            </span>
          </button>
        );
      })}
    </div>
  );
}
