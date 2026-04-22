/**
 * 6대 지표 레이더 차트
 *  - 각 축에 빨간 화살표(외곽 → 데이터 꼭짓점) 항상 표시
 *  - 우상단 라운드 핀에 선택된 지표/평균 점수 노출 (기본: 기억력)
 *  - 꼭짓점 클릭 시 선택 지표 변경 + onPointClick 통지(선택)
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

const METRICS = [
  { key: 'memory', label: '기억력', angle: 0 },
  { key: 'comprehension', label: '이해력', angle: 60 },
  { key: 'focus', label: '집중력', angle: 120 },
  { key: 'judgment', label: '판단력', angle: 180 },
  { key: 'agility', label: '순발력', angle: 240 },
  { key: 'endurance', label: '지구력', angle: 300 },
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
  // 기본 선택: 기억력 (시안 동일)
  const [selectedKey, setSelectedKey] = useState<string>('memory');
  const center = size / 2;
  const radius = size * 0.4;
  const selectedMetric = METRICS.find((m) => m.key === selectedKey) ?? METRICS[0];
  const selectedValue = Math.round(
    (data[selectedMetric.key as keyof typeof data] as number) || 0,
  );

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

    // 데이터 폴리곤 (영역은 라임 반투명, 외곽선은 흰색으로 또렷하게)
    ctx.fillStyle = 'rgba(170, 237, 16, 0.22)';
    ctx.strokeStyle = '#FFFFFF';
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

    // 꼭짓점 — 모두 동일한 라임 + 흰색 외곽 (원형 디자인 유지)
    METRICS.forEach((metric) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const n = value / 100;
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const x = center + radius * n * Math.cos(angle);
      const y = center + radius * n * Math.sin(angle);
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
  }, [data, size, center, radius, selectedKey]);

  const handleClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    let best: { key: string; label: string; value: number; d: number } | null = null;
    METRICS.forEach((metric) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const n = value / 100;
      const rad = ((metric.angle - 90) * Math.PI) / 180;
      const vx = center + radius * n * Math.cos(rad);
      const vy = center + radius * n * Math.sin(rad);
      const d = Math.hypot(px - vx, py - vy);
      if (!best || d < best.d) best = { key: metric.key, label: metric.label, value, d };
    });
    const found = best as { key: string; label: string; value: number; d: number } | null;
    if (found && found.d <= 30) {
      setSelectedKey(found.key);
      onPointClick?.(found.label, found.value);
      onPointHover?.(found.label, found.value);
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
      {/* 우상단 고정 핀 — 선택 지표 + 평균 점수 (컴팩트, 라임 액센트) */}
      <div
        className="absolute rounded-md px-2 py-1 text-[9px] leading-tight shadow"
        style={{
          top: 0,
          right: 0,
          backgroundColor: '#1A1A1A',
          color: '#E5E5E5',
          border: '1px solid rgba(170,237,16,0.55)',
        }}
      >
        <div className="font-semibold text-white">{selectedMetric.label}</div>
        <div>
          {pinLabel} : <span className="font-bold" style={{ color: ACCENT }}>{selectedValue}점</span>
        </div>
      </div>
    </div>
  );
}
