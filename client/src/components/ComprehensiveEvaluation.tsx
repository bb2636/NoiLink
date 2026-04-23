import { useState } from 'react';
import type { MetricsScore } from '@noilink/shared';

/**
 * 뇌지컬 종합 평가 — 개인 리포트와 기업 리포트에서 동일한 UI로 사용.
 *
 * 데이터 소스:
 *  - report.metricsScore: 6대 지표
 *  - report.metricEvidenceCards: 상세 분석 카드(없으면 기본 문구)
 *  - feedbackItems: 생활 밀착 피드백(상위 페이지에서 주입)
 */

const METRIC_LABEL_KO: Record<keyof Omit<MetricsScore, 'sessionId' | 'userId' | 'createdAt' | 'rhythm'>, string> = {
  memory: '기억력',
  comprehension: '이해력',
  focus: '집중력',
  judgment: '판단력',
  agility: '순발력',
  endurance: '지구력',
};

type MetricKey = keyof typeof METRIC_LABEL_KO;
const METRIC_KEYS: MetricKey[] = ['memory', 'comprehension', 'focus', 'judgment', 'agility', 'endurance'];

const STRENGTH_COLORS = ['#AAED10', '#5EEAD4', '#D9F779'] as const;
const ICON_TYPES: ('trend' | 'shield' | 'flag')[] = ['trend', 'shield', 'flag'];
const ICON_COLORS = ['#AAED10', '#5EEAD4', '#A78BFA'] as const;

function statusByValue(v: number): string {
  if (v >= 85) return '탁월함';
  if (v >= 70) return '안정적';
  if (v >= 55) return '성장 중';
  return '보완 필요';
}

export interface FeedbackItem {
  n: number;
  icon: string;
  title: string;
}

export interface ComprehensiveEvaluationProps {
  metricsScore: MetricsScore;
  evidenceTitles?: string[]; // 상세 분석 — 외부에서 주입(없으면 기본 문구)
  feedbackItems?: FeedbackItem[]; // 생활 밀착 피드백
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export default function ComprehensiveEvaluation({
  metricsScore,
  evidenceTitles,
  feedbackItems,
  collapsible = true,
  defaultOpen = true,
}: ComprehensiveEvaluationProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState(0);

  // 6대 지표 → 강점 3개(상위) / 약점 2개(하위)
  const ranked = METRIC_KEYS.map((k) => ({
    key: k,
    label: METRIC_LABEL_KO[k],
    value: typeof metricsScore[k] === 'number' ? Math.round(metricsScore[k] as number) : 70,
  })).sort((a, b) => b.value - a.value);

  const strengths = ranked.slice(0, 3);
  const weaknesses = ranked.slice(-2).reverse();

  const titles =
    evidenceTitles && evidenceTitles.length > 0
      ? evidenceTitles.slice(0, 3)
      : [
          '쉽게 포기하지 않는 꾸준형',
          '화려한 말뿐보다는 행동으로 보여주는 신뢰형',
          '한번 시작한 일은 끝을 보고야 마는 완주형',
        ];

  const items: FeedbackItem[] =
    feedbackItems && feedbackItems.length > 0
      ? feedbackItems
      : [
          { n: 1, icon: '🧘', title: '1시간마다 스트레칭하기' },
          { n: 2, icon: '🎯', title: '새로운 선택 도전해보기' },
          { n: 3, icon: '🤝', title: '주변에 도움 요청하기' },
        ];

  const Body = (
    <div className="pt-4 space-y-5">
      {/* 상세 분석 */}
      <div>
        <h4 className="text-xs text-gray-300 mb-2 pl-2 border-l-2" style={{ borderColor: '#AAED10' }}>
          상세 분석
        </h4>
        <div
          className="rounded-2xl p-3 space-y-2"
          style={{ backgroundColor: '#202024', border: '1px solid #2A2A2A' }}
        >
          {titles.map((t, i) => (
            <EvalRow key={i} iconType={ICON_TYPES[i % 3]} iconColor={ICON_COLORS[i % 3]} title={t} />
          ))}
        </div>
      </div>

      {/* 강점 분석 */}
      <div>
        <h4 className="text-xs text-gray-300 mb-3 pl-2 border-l-2" style={{ borderColor: '#AAED10' }}>
          강점 분석
        </h4>
        <div className="grid grid-cols-3 gap-2">
          {strengths.map((s, i) => (
            <StrengthGauge
              key={s.key}
              value={s.value}
              status={statusByValue(s.value)}
              label={s.label}
              color={STRENGTH_COLORS[i % 3]}
            />
          ))}
        </div>
      </div>

      {/* 약점 분석 */}
      <div>
        <h4 className="text-xs text-gray-300 mb-3 pl-2 border-l-2" style={{ borderColor: '#AAED10' }}>
          약점 분석
        </h4>
        <div className="space-y-2">
          {weaknesses.map((w) => (
            <WeaknessRow key={w.key} label={w.label} value={w.value} />
          ))}
        </div>
      </div>

      {/* 생활 밀착 피드백 */}
      <div>
        <h4 className="text-xs text-gray-400 mb-3 pl-2 border-l-2" style={{ borderColor: '#AAED10' }}>
          생활 밀착 피드백
        </h4>
        <div className="space-y-2">
          {items.map((f, i) => (
            <FeedbackStep
              key={f.n}
              n={f.n}
              icon={f.icon}
              title={f.title}
              selected={i === selected}
              onClick={() => setSelected(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-base font-bold text-white">뇌지컬 종합 평가</span>
          <span className="text-gray-400">{open ? '⌃' : '⌄'}</span>
        </button>
      ) : (
        <h3 className="text-lg font-bold text-white">뇌지컬 종합 평가</h3>
      )}
      {(!collapsible || open) && Body}
    </section>
  );
}

// =============================================================================
// 내부 서브 컴포넌트 — 외부에서도 import 가능하도록 named export
// =============================================================================

export function EvalRow({
  iconType,
  iconColor,
  title,
}: {
  iconType: 'trend' | 'shield' | 'flag';
  iconColor: string;
  title: string;
}) {
  const renderIcon = () => {
    switch (iconType) {
      case 'trend':
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={iconColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 17 9 11 13 15 21 7" />
            <polyline points="14 7 21 7 21 14" />
          </svg>
        );
      case 'shield':
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
          </svg>
        );
      case 'flag':
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 21V4" />
            <path d="M5 4h11l-2 4 2 4H5" />
          </svg>
        );
    }
  };
  return (
    <div
      className="rounded-2xl px-3 py-3 flex items-center gap-3"
      style={{ backgroundColor: '#2D2D33', border: '1px solid #3A3A40' }}
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: '#1A1A1A', border: `1.5px solid ${iconColor}40` }}
      >
        {renderIcon()}
      </span>
      <p className="text-[13px] text-white">{title}</p>
    </div>
  );
}

export function StrengthGauge({
  value,
  status,
  label,
  color,
}: {
  value: number;
  status: string;
  label: string;
  color: string;
}) {
  const SIZE = 88;
  const STROKE = 7;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - value / 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="#2A2A2A" strokeWidth={STROKE} fill="none" />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ backgroundColor: `${color}26`, color }}
          >
            {status}
          </span>
        </div>
      </div>
      <span className="text-[11px] text-gray-300 mt-2 text-center">{label}</span>
    </div>
  );
}

export function WeaknessRow({ label, value }: { label: string; value: number }) {
  const PURPLE = '#A78BFA';
  return (
    <div
      className="rounded-2xl px-3 py-3"
      style={{ backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A' }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#2A1F3D' }}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke={PURPLE}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        <p className="flex-1 text-[13px] text-white">{label}</p>
        <span className="text-sm font-bold" style={{ color: PURPLE }}>
          {value}점
        </span>
      </div>
      <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#2A2A2A' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, #6D4FB8 0%, ${PURPLE} 100%)`,
          }}
        />
      </div>
    </div>
  );
}

export function FeedbackStep({
  n,
  icon,
  title,
  selected,
  onClick,
}: {
  n: number;
  icon: string;
  title: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl px-3 py-3 flex items-center gap-3 text-left transition-colors"
      style={{
        backgroundColor: selected ? '#1F2D14' : '#0F0F0F',
        border: selected ? '1px solid #AAED10' : '1px solid #1F1F1F',
      }}
    >
      <span className="text-xs font-bold shrink-0 w-6" style={{ color: selected ? '#AAED10' : '#888' }}>
        0{n}
      </span>
      <span className="text-base shrink-0">{icon}</span>
      <span className="text-sm flex-1" style={{ color: selected ? '#FFFFFF' : '#B6B6B9' }}>
        {title}
      </span>
      {selected && (
        <span className="text-xs shrink-0" style={{ color: '#AAED10' }}>
          ✓
        </span>
      )}
    </button>
  );
}
