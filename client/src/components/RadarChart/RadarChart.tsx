import { useRef, useEffect } from 'react';

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
  /** 꼭짓점(데이터 점) 근처 클릭 시 — 툴팁용 */
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

export default function RadarChart({
  data,
  size = 200,
  onPointClick,
  onPointHover,
}: RadarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const center = size / 2;
  const radius = size * 0.4;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw grid circles
    for (let i = 1; i <= 5; i++) {
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center, center, (radius * i) / 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw axis lines
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    METRICS.forEach((metric) => {
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(
        center + radius * Math.cos(angle),
        center + radius * Math.sin(angle)
      );
      ctx.stroke();
    });

    // Draw data polygon
    ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 2;
    ctx.beginPath();

    METRICS.forEach((metric, index) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const normalizedValue = value / 100;
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const x = center + radius * normalizedValue * Math.cos(angle);
      const y = center + radius * normalizedValue * Math.sin(angle);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw points
    METRICS.forEach((metric) => {
      const value = data[metric.key as keyof typeof data] || 0;
      const normalizedValue = value / 100;
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const x = center + radius * normalizedValue * Math.cos(angle);
      const y = center + radius * normalizedValue * Math.sin(angle);

      ctx.fillStyle = '#0ea5e9';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw labels
    ctx.fillStyle = '#374151';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    METRICS.forEach((metric) => {
      const angle = ((metric.angle - 90) * Math.PI) / 180;
      const labelRadius = radius + 20;
      const x = center + labelRadius * Math.cos(angle);
      const y = center + labelRadius * Math.sin(angle);
      ctx.fillText(metric.label, x, y);
    });
  }, [data, size, center, radius]);

  const emitPoint = (metricLabel: string, value: number) => {
    onPointClick?.(metricLabel, value);
    onPointHover?.(metricLabel, value);
  };

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          let best: { label: string; value: number; d: number } | null = null;
          METRICS.forEach((metric) => {
            const value = data[metric.key as keyof typeof data] || 0;
            const normalizedValue = value / 100;
            const rad = ((metric.angle - 90) * Math.PI) / 180;
            const vx = center + radius * normalizedValue * Math.cos(rad);
            const vy = center + radius * normalizedValue * Math.sin(rad);
            const d = Math.hypot(px - vx, py - vy);
            if (!best || d < best.d) {
              best = { label: metric.label, value, d };
            }
          });
          const hit = 26;
          const found = best as { label: string; value: number; d: number } | null;
          if (found && found.d <= hit) {
            emitPoint(found.label, found.value);
          }
        }}
      />
    </div>
  );
}
