/**
 * 변화추이 차트
 *  - 6개 지표 + 전체 옵션을 드롭다운으로 선택
 *  - 선택 라벨:
 *      - 전체: 모두 선택 (6개)
 *      - 단일: 그 항목 이름 (예: "순발력")
 *      - 2개 이상 (전체 미만): "일부 선택"
 */
import { useEffect, useRef, useState } from 'react';

const METRIC_ORDER = [
  { key: 'memory', label: '기억력', color: '#22d3ee' },
  { key: 'comprehension', label: '이해력', color: '#a78bfa' },
  { key: 'focus', label: '집중력', color: '#AAED10' },
  { key: 'judgment', label: '판단력', color: '#fb923c' },
  { key: 'agility', label: '순발력', color: '#f472b6' },
  { key: 'endurance', label: '지구력', color: '#38bdf8' },
] as const;

const ALL_KEYS = METRIC_ORDER.map((m) => m.key);
type MetricKey = (typeof ALL_KEYS)[number];

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

export default function MultiTrendChart({ data, height = 220 }: MultiTrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<Set<MetricKey>>(new Set(ALL_KEYS));
  const [open, setOpen] = useState(false);

  const allOn = selected.size === ALL_KEYS.length;
  const triggerLabel = (() => {
    if (allOn) return '전체';
    if (selected.size === 0) return '선택 안 됨';
    if (selected.size === 1) {
      const onlyKey = [...selected][0];
      return METRIC_ORDER.find((m) => m.key === onlyKey)?.label ?? '선택';
    }
    return '일부 선택';
  })();

  const toggleAll = () => {
    setSelected(allOn ? new Set() : new Set(ALL_KEYS));
  };
  const toggleOne = (key: MetricKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ─── 캔버스 렌더링 ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const padding = 36;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, width, height);

    if (data.length === 0 || selected.size === 0) {
      // 빈 격자만
      ctx.strokeStyle = '#222';
      for (let i = 0; i <= 4; i++) {
        const y = padding + (chartH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
      }
      return;
    }

    const activeKeys: MetricKey[] = METRIC_ORDER.filter((m) => selected.has(m.key)).map((m) => m.key);
    const vals: number[] = [];
    data.forEach((p) => {
      activeKeys.forEach((k) => {
        const v = p[k];
        if (typeof v === 'number') vals.push(v);
      });
    });
    let minV = 0;
    let maxV = 100;
    if (vals.length > 0) {
      minV = Math.min(...vals, 0);
      maxV = Math.max(...vals, 100);
    }
    const range = maxV - minV || 1;

    // 격자
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (chartH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }
    // y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padding + (chartH * i) / 4;
      const v = Math.round(maxV - (range * i) / 4);
      ctx.fillText(String(v), padding - 6, y + 3);
    }

    // 라인 + 그라데이션 영역
    METRIC_ORDER.forEach(({ key, color }) => {
      if (!selected.has(key)) return;

      // 좌표 수집
      const pts: { x: number; y: number }[] = [];
      data.forEach((point, index) => {
        const v = point[key];
        if (typeof v !== 'number') return;
        const x = padding + (chartW * index) / Math.max(data.length - 1, 1);
        const y = padding + chartH - (chartH * (v - minV)) / range;
        pts.push({ x, y });
      });
      if (pts.length === 0) return;

      // 라인 아래 그라데이션 영역
      const grad = ctx.createLinearGradient(0, padding, 0, padding + chartH);
      grad.addColorStop(0, hexToRgba(color, 0.45));
      grad.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, padding + chartH);
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, padding + chartH);
      ctx.closePath();
      ctx.fill();

      // 라인
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // 꼭짓점
      ctx.fillStyle = color;
      pts.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // x축 날짜
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    data.forEach((point, index) => {
      if (index % Math.ceil(data.length / 5) !== 0 && index !== data.length - 1) return;
      const x = padding + (chartW * index) / Math.max(data.length - 1, 1);
      const d = new Date(point.date);
      ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x, height - 10);
    });
  }, [data, height, selected]);

  return (
    <div className="space-y-3">
      {/* 표시 기준 드롭다운 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">표시 기준</span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border"
            style={{
              backgroundColor: '#1A1A1A',
              borderColor: '#3A3A3A',
              color: '#fff',
            }}
          >
            <span>{triggerLabel}</span>
            <span className="text-xs" style={{ color: '#888' }}>
              ▾
            </span>
          </button>

          {open && (
            <>
              {/* 외부 클릭 닫기 */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setOpen(false)}
              />
              <div
                className="absolute right-0 top-full mt-2 z-20 rounded-2xl py-2 min-w-[160px] shadow-xl border"
                style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
              >
                <DropdownItem
                  label="전체"
                  active={allOn}
                  onClick={toggleAll}
                  color="#fff"
                />
                <div className="my-1 border-t" style={{ borderColor: '#2A2A2A' }} />
                {METRIC_ORDER.map((m) => (
                  <DropdownItem
                    key={m.key}
                    label={m.label}
                    active={selected.has(m.key)}
                    onClick={() => toggleOne(m.key)}
                    color={m.color}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 활성 항목 미니 범례 */}
      {selected.size > 0 && selected.size < ALL_KEYS.length && (
        <div className="flex flex-wrap gap-2">
          {METRIC_ORDER.filter((m) => selected.has(m.key)).map(({ key, label, color }) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs"
              style={{ backgroundColor: `${color}22`, color }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={400}
        height={height}
        className="w-full rounded-xl"
      />
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function DropdownItem({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors"
    >
      <span className="flex items-center gap-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span style={{ color: active ? '#fff' : '#888' }}>{label}</span>
      </span>
      {active && (
        <svg className="w-4 h-4" fill="none" stroke="#AAED10" viewBox="0 0 24 24" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}
