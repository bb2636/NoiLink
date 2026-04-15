import { useEffect, useRef, useState } from 'react';

const METRIC_ORDER = [
  { key: 'memory', label: '기억력', color: '#22d3ee' },
  { key: 'comprehension', label: '이해력', color: '#a78bfa' },
  { key: 'focus', label: '집중력', color: '#AAED10' },
  { key: 'judgment', label: '판단력', color: '#fb923c' },
  { key: 'agility', label: '순발력', color: '#f472b6' },
  { key: 'endurance', label: '지구력', color: '#38bdf8' },
] as const;

export type TrendPoint = {
  date: string;
  memory?: number;
  comprehension?: number;
  focus?: number;
  judgment?: number;
  agility?: number;
  endurance?: number;
};

interface MultiTrendChartProps {
  data: TrendPoint[];
  height?: number;
}

export default function MultiTrendChart({
  data,
  height = 220,
}: MultiTrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(METRIC_ORDER.map((m) => [m.key, true]))
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const padding = 36;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, 0, width, height);

    const activeKeys = METRIC_ORDER.filter((m) => visible[m.key]).map((m) => m.key);
    let minV = 0;
    let maxV = 100;
    if (activeKeys.length > 0) {
      const vals: number[] = [];
      data.forEach((p) => {
        activeKeys.forEach((k) => {
          const v = p[k as keyof TrendPoint];
          if (typeof v === 'number') vals.push(v);
        });
      });
      if (vals.length > 0) {
        minV = Math.min(...vals, 0);
        maxV = Math.max(...vals, 100);
      }
    }
    const range = maxV - minV || 1;

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (chartH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    METRIC_ORDER.forEach(({ key, color }) => {
      if (!visible[key]) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      data.forEach((point, index) => {
        const v = point[key as keyof TrendPoint];
        if (typeof v !== 'number') return;
        const x = padding + (chartW * index) / Math.max(data.length - 1, 1);
        const y = padding + chartH - (chartH * (v - minV)) / range;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      if (started) ctx.stroke();

      ctx.fillStyle = color;
      data.forEach((point, index) => {
        const v = point[key as keyof TrendPoint];
        if (typeof v !== 'number') return;
        const x = padding + (chartW * index) / Math.max(data.length - 1, 1);
        const y = padding + chartH - (chartH * (v - minV)) / range;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    data.forEach((point, index) => {
      if (index % Math.ceil(data.length / 5) !== 0 && index !== data.length - 1) return;
      const x = padding + (chartW * index) / Math.max(data.length - 1, 1);
      const d = new Date(point.date);
      ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x, height - 10);
    });
  }, [data, height, visible]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {METRIC_ORDER.map(({ key, label, color }) => (
          <button
            key={key}
            type="button"
            onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
            className="px-2 py-1 text-xs rounded-lg border transition-colors"
            style={{
              borderColor: visible[key] ? color : '#444',
              color: visible[key] ? color : '#888',
              backgroundColor: visible[key] ? `${color}22` : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} width={400} height={height} className="w-full rounded-xl" />
    </div>
  );
}
