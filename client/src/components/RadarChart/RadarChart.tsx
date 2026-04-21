/**
 * 6대 지표 레이더 차트
 *  - 꼭짓점 클릭 시 해당 위치에 툴팁(점수 표시) 띄움
 *  - onPointClick(label, value)로 부모에도 통지(선택)
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
  onPointClick,
  onPointHover,
}: RadarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const center = size / 2;
  const radius = size * 0.4;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    // 격자
    for (let i = 1; i <= 5; i++) {
      ctx.strokeStyle = '#2A2A2A';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center, center, (radius * i) / 5, 0, Math.PI * 2);
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

    // 데이터 폴리곤
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

    // 꼭짓점
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
      ctx.strokeStyle = '#0A0A0A';
      ctx.lineWidth = 2;
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
  }, [data, size, center, radius]);

  const handleClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    let best: { label: string; value: number; d: number; vx: number; vy: number } | null = null;
    METRICS.forEach((metric) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const n = value / 100;
      const rad = ((metric.angle - 90) * Math.PI) / 180;
      const vx = center + radius * n * Math.cos(rad);
      const vy = center + radius * n * Math.sin(rad);
      const d = Math.hypot(px - vx, py - vy);
      if (!best || d < best.d) best = { label: metric.label, value, d, vx, vy };
    });
    const found = best as { label: string; value: number; d: number; vx: number; vy: number } | null;
    if (found && found.d <= 26) {
      // 캔버스 좌표 → 표시 좌표
      setTip({
        x: found.vx / scaleX,
        y: found.vy / scaleY,
        label: found.label,
        value: Math.round(found.value),
      });
      onPointClick?.(found.label, found.value);
      onPointHover?.(found.label, found.value);
    } else {
      setTip(null);
    }
  };

  return (
    <div
      className="relative inline-block"
      style={{ width: size, height: size }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setTip(null);
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="cursor-pointer"
        style={{ width: size, height: size }}
        onClick={handleClick}
      />
      {tip && (
        <div
          className="absolute pointer-events-none rounded-lg px-2.5 py-1 text-xs font-bold shadow-lg whitespace-nowrap"
          style={{
            left: tip.x,
            top: tip.y,
            transform: 'translate(-50%, -130%)',
            backgroundColor: ACCENT,
            color: '#000',
          }}
        >
          {tip.label} {tip.value}점
          <span
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: -4,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: `5px solid ${ACCENT}`,
            }}
          />
        </div>
      )}
    </div>
  );
}
