import type { Level, MetricsScore, TrainingMode } from '@noilink/shared';
import {
  buildSyntheticRawMetrics,
  buildTrainingPhases,
  inferQualityFromTaps,
} from '@noilink/shared';
import { API_BASE_URL } from '../config';
import { getAuthHeaders, resolveTrainingUserId } from '../auth/storage';

function avgMetricScore(m: MetricsScore): number | undefined {
  const vals = [
    m.memory,
    m.comprehension,
    m.focus,
    m.judgment,
    m.agility,
    m.endurance,
  ].filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!API_BASE_URL) {
    return { ok: false, error: 'API_BASE_URL 미설정(EXPO_PUBLIC_API_URL)' };
  }
  const headers = await getAuthHeaders();
  if (!headers.Authorization) {
    return { ok: false, error: '로그인이 필요합니다(토큰 없음)' };
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: json.error || res.statusText };
  }
  if (json.success === false) {
    return { ok: false, error: json.error || '요청 실패' };
  }
  return { ok: true, data: json.data as T };
}

export async function submitTrainingToServer(input: {
  userId: string;
  mode: TrainingMode;
  bpm: number;
  level: Level;
  totalDurationSec: number;
  yieldsScore: boolean;
  isComposite: boolean;
  tapCount: number;
}): Promise<{ sessionId: string; displayScore?: number; error?: string }> {
  const durationMs = input.totalDurationSec * 1000;
  const q = inferQualityFromTaps(input.tapCount, input.totalDurationSec);
  const phases = buildTrainingPhases({
    totalDurationMs: durationMs,
    bpm: input.bpm,
    level: input.level,
    mode: input.mode,
    isComposite: input.isComposite,
    quality: q,
  });

  const sessionRes = await postJson<{ id: string }>('/sessions', {
    userId: input.userId,
    mode: input.mode,
    bpm: input.bpm,
    level: input.level,
    duration: durationMs,
    isComposite: input.mode === 'COMPOSITE' || input.isComposite,
    isValid: true,
    phases,
  });

  if (!sessionRes.ok || !sessionRes.data?.id) {
    return { sessionId: '', error: sessionRes.error || '세션 저장 실패' };
  }

  const sessionId = sessionRes.data.id;

  if (!input.yieldsScore || input.mode === 'FREE') {
    return { sessionId };
  }

  const raw = buildSyntheticRawMetrics({ sessionId, userId: input.userId, quality: q });
  const calcRes = await postJson<MetricsScore>('/metrics/calculate', raw);
  if (!calcRes.ok || !calcRes.data) {
    return { sessionId, error: calcRes.error || '지표 계산 실패' };
  }

  return { sessionId, displayScore: avgMetricScore(calcRes.data) };
}
