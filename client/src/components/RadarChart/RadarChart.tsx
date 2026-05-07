/**
 * 6대 지표 레이더 차트
 *  - 기본 상태: 우상단 핀(지표명/평균) + 빨간 화살표 모두 숨김
 *  - 꼭짓점 클릭 시: 해당 지표의 핀 + 빨간 화살표 표시 (토글)
 *  - 같은 꼭짓점 재클릭 시: 둘 다 다시 숨김
 *  - 다른 꼭짓점 클릭 시: 그 지표로 전환
 */
import { useRef, useEffect, useState } from 'react';

interface RadarChartProps {
  data: {
    memory?: number;
    comprehension?: number;
    focus?: number;
    judgment?: number;
    agility?: number;
    endurance?: number;
  };
  size?: number;
  /** 핀 라벨 (기본: 조직 평균) */
  pinLabel?: string;
  onPointClick?: (metricLabel: string, value: number) => void;
  onPointHover?: (metric: string, value: number) => void;
}

// 시안 기준 시계방향: 기억력(상)→이해력(우상)→집중력(우하)→판단력(하)→지구력(좌하)→순발력(좌상)
const METRICS = [
  { key: 'memory',        label: '기억력', angle: 0 },
  { key: 'comprehension', label: '이해력', angle: 60 },
  { key: 'focus',         label: '집중력', angle: 120 },
  { key: 'judgment',      label: '판단력', angle: 180 },
  { key: 'endurance',     label: '지구력', angle: 240 },
  { key: 'agility',       label: '순발력', angle: 300 },
];

const ACCENT = '#AAED10';

export default function RadarChart({
  data,
  size = 200,
  pinLabel = '조직 평균',
  onPointClick,
  onPointHover,
}: RadarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 기본 상태는 미선택 — 꼭짓점 클릭 시에만 핀+화살표가 함께 표시되고,
  // 같은 꼭짓점을 다시 클릭하면 다시 사라진다 (단일 토글 상태로 통합).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const center = size / 2;
  const radius = size * 0.4;
  const selectedMetric = selectedKey ? METRICS.find((m) => m.key === selectedKey) ?? null : null;
  const selectedValue = selectedMetric
    ? Math.round((data[selectedMetric.key as keyof typeof data] as number) || 0)
    : 0;
  const arrowMetric = selectedMetric;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    // 격자 — 흰색 중첩 육각형 (벌집 모양)
    for (let i = 1; i <= 5; i++) {
      const r = (radius * i) / 5;
      // 외곽 링은 좀 더 또렷하게, 안쪽은 살짝 흐리게
      ctx.strokeStyle = i === 5 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      METRICS.forEach((metric, idx) => {
        const angle = ((metric.angle - 90) * Math.PI) / 180;
        const x = center + r * Math.cos(angle);
        const y = center + r * Math.sin(angle);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // 축
    ctx.strokeStyle = '#333';
    METRICS.forEach((metric) => {
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
      ctx.stroke();
    });

    // 데이터 폴리곤 (영역 라임 반투명 + 외곽선도 라임으로 강조 — 시안 동일)
    ctx.fillStyle = 'rgba(170, 237, 16, 0.18)';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    METRICS.forEach((metric, idx) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const n = value / 100;
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const x = center + radius * n * Math.cos(angle);
      const y = center + radius * n * Math.sin(angle);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 꼭짓점 — 흰색 작은 도트 (시안)
    METRICS.forEach((metric) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const n = value / 100;
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const x = center + radius * n * Math.cos(angle);
      const y = center + radius * n * Math.sin(angle);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 라벨
    ctx.fillStyle = '#B6B6B9';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    METRICS.forEach((metric) => {
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const labelRadius = radius + 22;
      const x = center + labelRadius * Math.cos(angle);
      const y = center + labelRadius * Math.sin(angle);
      ctx.fillText(metric.label, x, y);
    });

    // 빨간 화살표 — 클릭한 꼭짓점만 강조 (외곽 → 데이터 꼭짓점)
    if (arrowMetric) {
      const value = (data[arrowMetric.key as keyof typeof data] as number) || 0;
      const n = value / 100;
      const ang = ((arrowMetric.angle - 90) * Math.PI) / 180;
      const tipX = center + radius * n * Math.cos(ang);
      const tipY = center + radius * n * Math.sin(ang);
      // 외곽 약간 바깥에서 시작
      const startR = radius + 14;
      const startX = center + startR * Math.cos(ang);
      const startY = center + startR * Math.sin(ang);

      const RED = '#EF4444';
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';

      // 화살표 줄기 (촉 직전까지)
      const HEAD = 9;
      const dx = tipX - startX;
      const dy = tipY - startY;
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      const shaftEndX = tipX - ux * HEAD * 0.6;
      const shaftEndY = tipY - uy * HEAD * 0.6;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(shaftEndX, shaftEndY);
      ctx.stroke();

      // 화살촉 (꼭짓점을 향하는 삼각형)
      const leftX = tipX - HEAD * (ux * Math.cos(0.5) - uy * Math.sin(0.5));
      const leftY = tipY - HEAD * (uy * Math.cos(0.5) + ux * Math.sin(0.5));
      const rightX = tipX - HEAD * (ux * Math.cos(-0.5) - uy * Math.sin(-0.5));
      const rightY = tipY - HEAD * (uy * Math.cos(-0.5) + ux * Math.sin(-0.5));

      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();

      // 꼭짓점 위 빨간 도트(강조)
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data, size, center, radius, selectedKey, arrowMetric]);

  const handleClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    // 지표별 점수가 작으면(예: 지구력=0) 데이터 꼭짓점이 차트 중앙 근처에 찍히고,
    // 사용자는 보통 외곽의 라벨 텍스트("지구력")를 눌러 선택하려 한다. 점-거리
    // 기반(d<=30)으로는 점이 멀리 있어 그 지표만 선택이 안 되는 문제가 발생한다.
    // → 클릭 위치의 각도(중심 기준)를 6분할 섹터로 매핑해 어느 지표 영역인지로
    //    판정한다. 정 중앙(<5%)과 라벨 바깥(>radius+35) 만 무선택 처리.
    const dx = px - center;
    const dy = py - center;
    const dist = Math.hypot(dx, dy);
    if (dist > radius + 35 || dist < radius * 0.05) {
      setSelectedKey(null);
      return;
    }
    // 차트 좌표계: 상단 = 0deg, 시계방향. atan2 결과(-180~180)에 +90 으로 보정.
    let clickAngle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (clickAngle < 0) clickAngle += 360;
    if (clickAngle >= 360) clickAngle -= 360;

    let bestMetric: typeof METRICS[number] | null = null;
    let bestDelta = 360;
    METRICS.forEach((metric) => {
      // 원형 거리 — 360도 wrap-around 고려.
      const raw = Math.abs(metric.angle - clickAngle);
      const delta = Math.min(raw, 360 - raw);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMetric = metric;
      }
    });

    if (bestMetric) {
      const m = bestMetric as typeof METRICS[number];
      const value = (data[m.key as keyof typeof data] as number) || 0;
      // 같은 꼭짓점 재클릭 → 닫기, 다른 꼭짓점 클릭 → 그 지표로 전환
      setSelectedKey((prev) => (prev === m.key ? null : m.key));
      onPointClick?.(m.label, value);
      onPointHover?.(m.label, value);
    }
  };

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="cursor-pointer"
        style={{ width: size, height: size }}
        onClick={handleClick}
      />
      {/* 우상단 핀 — 꼭짓점 클릭 시에만 노출 (선택 지표 + 평균 점수). 재클릭 시 사라짐. */}
      {selectedMetric && (
        <div
          className="absolute rounded-lg px-3 py-1.5 text-[11px] leading-tight shadow-lg"
          style={{
            top: size * 0.18,
            right: 0,
            backgroundColor: '#262626',
            color: '#E5E5E5',
            border: '1px solid rgba(170,237,16,0.35)',
            minWidth: 92,
          }}
        >
          <div className="font-semibold text-white mb-0.5">{selectedMetric.label}</div>
          <div className="text-[10px]" style={{ color: '#cfcfcf' }}>
            {pinLabel} : <span className="font-bold" style={{ color: ACCENT }}>{selectedValue}점</span>
          </div>
        </div>
      )}

    </div>
  );
}
