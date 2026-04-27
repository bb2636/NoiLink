/**
 * 변화추이 차트
 *  - 6개 지표 + 전체 옵션을 드롭다운으로 선택
 *  - 선택 라벨:
 *      - 전체: 모두 선택 (6개)
 *      - 단일: 그 항목 이름 (예: "순발력")
 *      - 2개 이상 (전체 미만): "일부 선택"
 *  - X축: 최근 10회 트레이닝 시도("1회","2회",...,"10회")
 *  - Y축: 0~100, 20단위 격자
 */
import { ReactNode, useEffect, useRef, useState } from 'react';

const METRIC_ORDER = [
  { key: 'memory', label: '기억력', color: '#3b82f6' },
  { key: 'comprehension', label: '이해력', color: '#2DD4BF' },
  { key: 'focus', label: '집중력', color: '#F59E0B' },
  { key: 'judgment', label: '판단력', color: '#EF4444' },
  { key: 'endurance', label: '지구력', color: '#A78BFA' },
  { key: 'agility', label: '순발력', color: '#84CC16' },
] as const;

const ALL_KEYS = METRIC_ORDER.map((m) => m.key);
type MetricKey = (typeof ALL_KEYS)[number];

const Y_MIN = 20;
const Y_MAX = 100;
const Y_STEP = 20;
const MAX_POINTS = 10;

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
  headerLeft?: ReactNode;
}

export default function MultiTrendChart({ data, height = 220, headerLeft }: MultiTrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<Set<MetricKey>>(new Set(ALL_KEYS));
  const [open, setOpen] = useState(false);

  // 최근 10회만 사용(시간순 가정)
  const recent = data.slice(-MAX_POINTS);

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

    const ySteps = (Y_MAX - Y_MIN) / Y_STEP; // 5

    // 격자 + y축 라벨 (0~100, 20단위)
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= ySteps; i++) {
      const y = padding + (chartH * i) / ySteps;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      const v = Y_MAX - Y_STEP * i;
      ctx.fillText(String(v), padding - 6, y + 3);
    }

    if (recent.length === 0 || selected.size === 0) return;

    const range = Y_MAX - Y_MIN;

    // 영역(층) — 뒤(기억력=파랑) → 앞(순발력=라임) 순으로 그려서 색 띠가 쌓이도록.
    // 그라데이션 페이드(=뒤 레이어를 잡아먹는 원인) 대신 솔리드 반투명 채움 사용.
    // 각 지표는 0~chartBottom 까지 자기 영역을 칠해서, 위로 갈수록 더 큰 값을 가진
    // 뒤 레이어가 띠처럼 노출된다 (이미지 2 스택 영역 차트 외관과 동일).
    const FILL_ALPHA = 0.55;
    METRIC_ORDER.forEach(({ key, color }) => {
      if (!selected.has(key)) return;

      const pts: { x: number; y: number }[] = [];
      recent.forEach((point, index) => {
        const v = point[key];
        if (typeof v !== 'number') return;
        const x = padding + (chartW * index) / Math.max(recent.length - 1, 1);
        const y = padding + chartH - (chartH * (v - Y_MIN)) / range;
        pts.push({ x, y });
      });
      if (pts.length === 0) return;

      ctx.fillStyle = hexToRgba(color, FILL_ALPHA);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, padding + chartH);
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, padding + chartH);
      ctx.closePath();
      ctx.fill();
    });

    // 라인 — 영역 위에 한 번 더 그려서 각 지표 경계를 또렷하게 (위와 동일한 뒤→앞 순서)
    METRIC_ORDER.forEach(({ key, color }) => {
      if (!selected.has(key)) return;

      const pts: { x: number; y: number }[] = [];
      recent.forEach((point, index) => {
        const v = point[key];
        if (typeof v !== 'number') return;
        const x = padding + (chartW * index) / Math.max(recent.length - 1, 1);
        const y = padding + chartH - (chartH * (v - Y_MIN)) / range;
        pts.push({ x, y });
      });
      if (pts.length === 0) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // 마지막 점에 색상 도트(이미지 2와 동일하게 우측 끝 강조)
      const last = pts[pts.length - 1];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // x축: 시도 횟수 ("1" ~ "n")
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    recent.forEach((_, index) => {
      const x = padding + (chartW * index) / Math.max(recent.length - 1, 1);
      ctx.fillText(String(index + 1), x, height - 10);
    });
  }, [recent, height, selected]);

  return (
    <div className="space-y-3">
      {/* 상단: 좌측 슬롯(타이틀 등) + 우측 전체 드롭다운 */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">{headerLeft}</div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-medium border leading-none"
            style={{
              backgroundColor: '#FFFFFF',
              borderColor: '#FFFFFF',
              color: '#000000',
            }}
          >
            <span>{triggerLabel}</span>
            <span className="text-[10px]" style={{ color: '#000' }}>
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

      <canvas
        ref={canvasRef}
        width={400}
        height={height}
        className="w-full rounded-xl"
      />

      {/* 고정 범례 — 6대 지표 색상 표시 (2행 3열, 가로/세로 가운데 정렬) */}
      <div className="grid grid-cols-[auto_auto_auto] gap-x-4 gap-y-0.5 pt-2 justify-center items-center">
        {METRIC_ORDER.map(({ key, label, color }) => (
          <div key={key} className="flex items-center justify-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] text-gray-300">{label}</span>
          </div>
        ))}
      </div>
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
