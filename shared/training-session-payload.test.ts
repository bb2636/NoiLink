import { describe, it, expect } from 'vitest';
import {
  inferQualityFromTaps,
  buildSyntheticRawMetrics,
  buildTrainingPhases,
} from './training-session-payload.js';

// ---------------------------------------------------------------------------
// inferQualityFromTaps — 터치율 기반 품질 0.25~1
// ---------------------------------------------------------------------------

describe('inferQualityFromTaps — durationSec/tap rate → q', () => {
  it('durationSec <= 0 → 0.5 (분모 보호; 빈 입력)', () => {
    expect(inferQualityFromTaps(0, 0)).toBe(0.5);
    expect(inferQualityFromTaps(100, 0)).toBe(0.5);
    expect(inferQualityFromTaps(100, -5)).toBe(0.5);
  });

  it('탭이 0 (rate=0) → 하한 0.35 → clamp 0.25 보호로 0.35', () => {
    // q = 0.35 + 0*0.9 = 0.35 → in range, returned as-is
    expect(inferQualityFromTaps(0, 10)).toBeCloseTo(0.35, 10);
  });

  it('중간 입력 (rate=0.1) → 0.44', () => {
    // q = 0.35 + 0.1*0.9 = 0.44
    expect(inferQualityFromTaps(1, 10)).toBeCloseTo(0.44, 10);
  });

  it('높은 탭률 → 상한 1로 clamp', () => {
    // rate=10, q=0.35+9 = 9.35 → clamp 1
    expect(inferQualityFromTaps(100, 10)).toBe(1);
  });

  it('하한 0.25 clamp (이론상 음수는 발생하지 않으나 방어 로직 유지)', () => {
    // 정상 경로에서는 q >= 0.35 이지만, 함수는 [0.25, 1]로 clamp 한다.
    const q = inferQualityFromTaps(0, 100);
    expect(q).toBeGreaterThanOrEqual(0.25);
    expect(q).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// buildSyntheticRawMetrics — 합성 RawMetrics 생성
// ---------------------------------------------------------------------------

describe('buildSyntheticRawMetrics — 모드별 블록·sessionId/userId 패스스루', () => {
  it('모든 모드 블록과 rhythm 블록을 포함한다', () => {
    const m = buildSyntheticRawMetrics({ sessionId: 's1', userId: 'u1', quality: 0.7 });
    expect(m.sessionId).toBe('s1');
    expect(m.userId).toBe('u1');
    expect(m.rhythm).toBeDefined();
    expect(m.memory).toBeDefined();
    expect(m.comprehension).toBeDefined();
    expect(m.focus).toBeDefined();
    expect(m.judgment).toBeDefined();
    expect(m.agility).toBeDefined();
    expect(m.endurance).toBeDefined();
  });

  it('createdAt 은 ISO 8601 문자열', () => {
    const m = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: 0.5 });
    expect(typeof m.createdAt).toBe('string');
    expect(() => new Date(m.createdAt).toISOString()).not.toThrow();
    expect(m.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('quality 상한 1 clamp (q=2 입력)', () => {
    const a = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: 2 });
    const b = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: 1 });
    // 동일 q 값으로 clamp되었는지 핵심 파생 필드로 확인
    expect(a.touchCount).toBe(b.touchCount);
    expect(a.rtMean).toBe(b.rtMean);
    expect(a.rhythm?.totalTicks).toBe(b.rhythm?.totalTicks);
    expect(a.rhythm?.perfectCount).toBe(b.rhythm?.perfectCount);
  });

  it('quality 하한 0.2 clamp (q=-1 입력 == q=0.2)', () => {
    const a = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: -1 });
    const b = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: 0.2 });
    expect(a.touchCount).toBe(b.touchCount);
    expect(a.rtMean).toBe(b.rtMean);
    expect(a.rhythm).toEqual(b.rhythm);
  });

  it('q=0.5 일 때 결정적 숫자 잠금 (회귀 방어)', () => {
    const m = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: 0.5 });
    // 명세 변경 시 의도적으로 함께 갱신되도록 핵심 수치를 잠금
    expect(m.touchCount).toBe(90); // round(30 + 60)
    expect(m.hitCount).toBe(75); // round(25 + 50)
    expect(m.rtMean).toBe(530); // round(720 - 190)
    expect(m.rtSD).toBe(95); // round(130 - 35)
    // rhythm
    expect(m.rhythm).toEqual({
      totalTicks: 48,
      perfectCount: 10, // round(48*0.5*0.42) = round(10.08)
      goodCount: 7, // round(48*0.5*0.28) = round(6.72)
      badCount: 5, // round(48*0.15*0.75) = round(5.4)
      missCount: 26, // 48 - 10 - 7 - 5
      accuracy: (10 * 1 + 7 * 0.5 + 5 * 0.2) / 48,
      avgOffset: 95, // round(140 - 45)
      offsetSD: 48, // round(70 - 22.5)
    });
  });

  it('rhythm.accuracy 는 [0, 1] 범위로 clamp', () => {
    for (const q of [0.2, 0.5, 0.8, 1]) {
      const m = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: q });
      expect(m.rhythm!.accuracy).toBeGreaterThanOrEqual(0);
      expect(m.rhythm!.accuracy).toBeLessThanOrEqual(1);
    }
  });

  it('rhythm 카운트 총합 = totalTicks (배분 일관성)', () => {
    for (const q of [0.2, 0.4, 0.7, 1]) {
      const m = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: q });
      const r = m.rhythm!;
      expect(r.perfectCount + r.goodCount + r.badCount + r.missCount).toBe(r.totalTicks);
    }
  });

  it('확률성 필드는 모두 [0, 1] 범위', () => {
    const m = buildSyntheticRawMetrics({ sessionId: 's', userId: 'u', quality: 0.6 });
    const fractions = [
      m.memory!.sequenceAccuracy,
      m.memory!.perfectRecallRate,
      m.comprehension!.switchErrorRate,
      m.comprehension!.ruleAccuracy,
      m.focus!.targetHitRate,
      m.focus!.commissionErrorRate,
      m.focus!.omissionErrorRate,
      m.judgment!.noGoSuccessRate,
      m.judgment!.goSuccessRate,
      m.judgment!.doubleTapSuccessRate,
      m.agility!.footAccuracy,
      m.agility!.anchorOmissionRate,
      m.agility!.simultaneousSuccessRate,
      m.endurance!.drift,
      m.endurance!.omissionIncrease,
    ];
    for (const f of fractions) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// buildTrainingPhases — Phase 메타 생성
// ---------------------------------------------------------------------------

describe('buildTrainingPhases — 종합/단일 분기', () => {
  it('단일(비-종합) 모드: 1개 COGNITIVE phase 만 반환', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 90,
      level: 2,
      mode: 'MEMORY',
      isComposite: false,
      quality: 0.6,
    });
    expect(phases.length).toBe(1);
    const p = phases[0];
    expect(p.type).toBe('COGNITIVE');
    expect(p.startTime).toBe(0);
    expect(p.endTime).toBe(60_000);
    expect(p.duration).toBe(60_000);
    expect(p.mode).toBe('MEMORY');
    expect(p.bpm).toBe(90);
    expect(p.level).toBe(2);
    expect(p.rhythmScore).toBeUndefined(); // RHYTHM 만 점수 부여
  });

  it('종합 모드 + 충분한 시간: RHYTHM(30s) + COGNITIVE 2개 phase', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 120_000,
      bpm: 100,
      level: 3,
      mode: 'FOCUS',
      isComposite: true,
      quality: 0.8,
    });
    expect(phases.length).toBe(2);
    expect(phases[0].type).toBe('RHYTHM');
    expect(phases[0].startTime).toBe(0);
    expect(phases[0].duration).toBe(30_000); // min(30000, 60000) = 30000
    expect(phases[0].endTime).toBe(30_000);
    expect(phases[0].mode).toBeUndefined(); // RHYTHM 은 mode 없음
    expect(phases[0].rhythmScore).toBeDefined();

    expect(phases[1].type).toBe('COGNITIVE');
    expect(phases[1].startTime).toBe(30_000);
    expect(phases[1].duration).toBe(90_000); // 120000 - 30000
    expect(phases[1].endTime).toBe(120_000);
    expect(phases[1].mode).toBe('FOCUS');
    expect(phases[1].rhythmScore).toBeUndefined();
  });

  it('종합 모드 + 짧은 시간 (60s): half=30s 가 cap → RHYTHM 30s + COG 30s', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 80,
      level: 1,
      mode: 'COMPREHENSION',
      isComposite: true,
      quality: 0.5,
    });
    expect(phases.length).toBe(2);
    expect(phases[0].duration).toBe(30_000);
    expect(phases[1].duration).toBe(30_000);
  });

  it('종합 모드 + 매우 짧은 시간 (10s): half=5s → RHYTHM 5s + COG 5s', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 10_000,
      bpm: 80,
      level: 1,
      mode: 'JUDGMENT',
      isComposite: true,
      quality: 0.5,
    });
    expect(phases.length).toBe(2);
    expect(phases[0].duration).toBe(5_000); // min(30000, 5000)
    expect(phases[1].duration).toBe(5_000);
  });

  it('종합 모드 + cogDur=0 (totalDurationMs=0) → 단일 COGNITIVE 분기로 폴백', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 0,
      bpm: 80,
      level: 1,
      mode: 'AGILITY',
      isComposite: true,
      quality: 0.5,
    });
    // half=0, rhythmDur=0, cogDur=0 → cogDur > 0 false → 단일 phase 폴백
    expect(phases.length).toBe(1);
    expect(phases[0].type).toBe('COGNITIVE');
    expect(phases[0].duration).toBe(0);
    // tickCount 는 Math.max(1, ...) 보호
    expect(phases[0].tickCount).toBe(1);
  });

  it('모든 phase 의 duration 합 = totalDurationMs', () => {
    for (const total of [10_000, 30_000, 60_000, 120_000, 300_000]) {
      const phases = buildTrainingPhases({
        totalDurationMs: total,
        bpm: 100,
        level: 3,
        mode: 'FOCUS',
        isComposite: true,
        quality: 0.5,
      });
      const sum = phases.reduce((s, p) => s + p.duration, 0);
      expect(sum).toBe(total);
    }
  });

  it('rhythmGrades 는 항상 모든 phase 에 정의됨 (PERFECT/GOOD/BAD/MISS)', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 120_000,
      bpm: 100,
      level: 3,
      mode: 'MEMORY',
      isComposite: true,
      quality: 0.5,
    });
    for (const p of phases) {
      expect(p.rhythmGrades).toEqual({ PERFECT: 4, GOOD: 8, BAD: 3, MISS: 1 });
    }
  });

  it('quality 하한 0.25 clamp (q=0 vs q=0.25 동일 결과)', () => {
    const a = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 100,
      level: 3,
      mode: 'FOCUS',
      isComposite: false,
      quality: 0,
    });
    const b = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 100,
      level: 3,
      mode: 'FOCUS',
      isComposite: false,
      quality: 0.25,
    });
    expect(a[0].hitCount).toBe(b[0].hitCount);
  });

  it('quality 상한 1 clamp (q=10 vs q=1 동일 결과)', () => {
    const a = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 100,
      level: 3,
      mode: 'FOCUS',
      isComposite: false,
      quality: 10,
    });
    const b = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 100,
      level: 3,
      mode: 'FOCUS',
      isComposite: false,
      quality: 1,
    });
    expect(a[0].hitCount).toBe(b[0].hitCount);
  });

  it('hitCount, missCount 는 음수가 되지 않음', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 100,
      level: 3,
      mode: 'MEMORY',
      isComposite: true,
      quality: 0.25,
    });
    for (const p of phases) {
      expect(p.hitCount).toBeGreaterThanOrEqual(0);
      expect(p.missCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('bpm/level 은 그대로 패스스루', () => {
    const phases = buildTrainingPhases({
      totalDurationMs: 60_000,
      bpm: 137,
      level: 4,
      mode: 'JUDGMENT',
      isComposite: true,
      quality: 0.6,
    });
    for (const p of phases) {
      expect(p.bpm).toBe(137);
      expect(p.level).toBe(4);
    }
  });
});
