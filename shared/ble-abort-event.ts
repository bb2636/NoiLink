/**
 * BLE 단절로 자동 종료된 트레이닝 세션의 운영 텔레메트리 페이로드.
 *
 * 흐름:
 *  - 클라이언트(`TrainingSessionPlay.finalizeAndAbort('ble-disconnect')`)가 회복 통계
 *    (`windows`, `totalMs`)와 환경 점검 안내 분류(`bleUnstable`)를 fire-and-forget
 *    으로 서버 `POST /api/metrics/ble-abort` 에 보낸다.
 *  - 서버는 정규화 후 `bleAbortEvents` 컬렉션에 한 건 append 하고, 한 줄 콘솔 로그를
 *    남긴다 (`docs/operations/ble-abort-telemetry.md` 참고).
 *
 * 익명성:
 *  - userId / username / 토큰 / 이메일 / 디바이스 식별자 등 어떤 PII도 포함하지
 *    않는다 — 운영자 측 집계(예: "지난 7일 BLE 자동 종료 중 환경 점검 안내가 떴던
 *    비율") 외 용도로 쓰일 수 없도록 페이로드를 의도적으로 좁게 유지한다.
 *  - 트레이닝 모드(`apiMode`)는 카테고리 라벨이라 PII 가 아니므로 모드별 신뢰도/추세
 *    분석을 위해 선택적으로 함께 보낸다.
 */

import type { TrainingMode } from './types.js';

/** 클라이언트가 보내는 입력 페이로드 (occurredAt 은 서버가 부착). */
export interface BleAbortEventInput {
  /** 세션 동안 발생한 회복 구간 횟수 (정수, 0 이상). */
  windows: number;
  /** 회복 구간 누적 시간(ms) (정수, 0 이상). */
  totalMs: number;
  /**
   * 환경 점검 안내(노란 토스트/배너)가 사용자에게 표시될 임계를 넘겼는지 여부.
   * `client/src/pages/trainingAbortReason.ts::isBleUnstableForAbort` 와 동일한
   * 판정 기준 (windows ≥ 1 OR totalMs ≥ 5000) 으로 클라이언트에서 계산해 보낸다.
   * 서버에서는 임계 변경에 대비해 raw 통계도 함께 저장한다.
   */
  bleUnstable: boolean;
  /** 트레이닝 모드 라벨 (모드별 신뢰도 분석용, 선택). */
  apiMode?: TrainingMode;
}

/** 서버가 영속화하는 최종 이벤트 모양. */
export interface BleAbortEvent extends BleAbortEventInput {
  /** 서버 수신 시각 (ISO-8601). */
  occurredAt: string;
}

const VALID_TRAINING_MODES: ReadonlySet<TrainingMode> = new Set<TrainingMode>([
  'MEMORY',
  'COMPREHENSION',
  'FOCUS',
  'JUDGMENT',
  'AGILITY',
  'ENDURANCE',
  'COMPOSITE',
  'FREE',
]);

function sanitizeNonNegInt(n: unknown): number | null {
  if (typeof n !== 'number') return null;
  // NaN/Infinity/음수는 0으로 클램프 — recovery-stats 사니타이저와 동일한 정책으로
  // 운영 집계가 잘못된 모양 한 건에 막히지 않도록 한다. 숫자 타입이 전혀 아닐 때만 거부한다.
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * 클라이언트 페이로드를 안전한 모양으로 정규화한다.
 * - windows / totalMs: 음수·NaN·부동소수는 정수·0 이상으로 클램프.
 * - bleUnstable: 비-boolean 입력은 false 로 강제.
 * - apiMode: 알려진 TrainingMode 만 통과, 그 외는 누락 처리.
 *
 * windows 또는 totalMs 가 숫자가 전혀 아닌 경우(둘 다 누락 등)는 null 을 돌려
 * 호출 측이 잘못된 페이로드로 분류할 수 있도록 한다.
 */
export function sanitizeBleAbortEventInput(input: unknown): BleAbortEventInput | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const windows = sanitizeNonNegInt(obj.windows);
  const totalMs = sanitizeNonNegInt(obj.totalMs);
  if (windows === null || totalMs === null) return null;
  const bleUnstable = obj.bleUnstable === true;
  const apiMode =
    typeof obj.apiMode === 'string' && VALID_TRAINING_MODES.has(obj.apiMode as TrainingMode)
      ? (obj.apiMode as TrainingMode)
      : undefined;
  return {
    windows,
    totalMs,
    bleUnstable,
    ...(apiMode ? { apiMode } : {}),
  };
}
