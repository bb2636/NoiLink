/**
 * `native.ack` 거부 토스트(`subscribeAckErrorBanner`) 의 자동 닫힘 / 사용자 닫힘 /
 * burst 통계를 운영 데이터로 모으기 위한 텔레메트리 페이로드 (Task #116).
 *
 * 흐름:
 *  - 클라이언트(`subscribeAckErrorBanner`) 가 burst 가 끝나는 시점 — 즉
 *    1) 자동 닫힘 타이머가 발화하거나, 2) 페이지가 `notifyDismissed()` 로 외부 닫힘을
 *    알리거나, 3) 구독 자체가 `unsubscribe()` 로 해제될 때 — 한 건의 익명 페이로드를
 *    fire-and-forget 으로 `POST /api/metrics/ack-banner` 에 보낸다.
 *  - 서버는 정규화 후 `ackBannerEvents` 컬렉션에 한 건 append 하고 한 줄 콘솔 로그를 남긴다.
 *
 * 익명성:
 *  - userId / 토큰 / 디바이스 식별자 / 에러 메시지 본문 등 어떤 PII 도 포함하지 않는다.
 *  - 운영자가 보고 싶은 것은 "burst 평균 길이", "자동 닫힘 비율", "burst 가 끝났는데도
 *    자동 닫힘이 안 발화하는 빈도" 뿐이므로 페이로드를 의도적으로 좁게 유지한다.
 *  - 추후 어떤 화면/메시지 키가 burst 를 만드는지 분해가 필요해지면 카테고리 라벨을
 *    화이트리스트로만 추가하기로 한다 — 본 1차 버전은 출처를 받지 않는다.
 */

/**
 * burst 가 어떻게 끝났는지 — 운영 집계에서 자동 닫힘 vs 사용자 닫힘 비율을 계산하는 키.
 *  - `auto-dismiss`: subscriber 의 자동 닫힘 타이머가 끝까지 살아남아 발화한 경우.
 *  - `user-dismiss`: 페이지(SuccessBanner.onClose 등)가 `notifyDismissed()` 로 외부에서
 *    banner 가 닫혔음을 알린 경우.
 *  - `unmount`: 화면 이동/언마운트로 `unsubscribe()` 가 먼저 호출돼 자동 닫힘이 발화 못한 경우.
 *    이 비율이 비정상적으로 높으면 "burst 가 끝났는데도 자동 닫힘이 안 떠 사용자가
 *    카운터를 들고 페이지를 뜨는" 코너 케이스를 의심해볼 수 있다.
 */
export type AckBannerDismissReason = 'auto-dismiss' | 'user-dismiss' | 'unmount';

const VALID_DISMISS_REASONS: ReadonlySet<AckBannerDismissReason> = new Set<AckBannerDismissReason>([
  'auto-dismiss',
  'user-dismiss',
  'unmount',
]);

/** 클라이언트가 보내는 입력 페이로드 (occurredAt 은 서버가 부착). */
export interface AckBannerEventInput {
  /** burst 가 어떻게 끝났는지. */
  reason: AckBannerDismissReason;
  /**
   * burst 안에서 누적된 거부 횟수 (정수, 1 이상). 단발 거부도 1 로 기록되어
   * "단발 거부가 자동 닫힘으로 사라지는 비율" 도 함께 측정할 수 있다.
   */
  burstCount: number;
  /**
   * burst 의 첫 거부부터 닫힘 시점까지의 경과 시간(ms) (정수, 0 이상).
   * burst 평균 길이를 보고 `ACK_ERROR_AUTO_DISMISS_MS` 임계값을 튜닝하는 입력으로 쓴다.
   */
  burstDurationMs: number;
}

/** 서버가 영속화하는 최종 이벤트 모양. */
export interface AckBannerEvent extends AckBannerEventInput {
  /** 서버 수신 시각 (ISO-8601). */
  occurredAt: string;
}

function sanitizeNonNegInt(n: unknown): number | null {
  if (typeof n !== 'number') return null;
  // NaN/Infinity/음수는 0으로 클램프 — recovery / ble-abort 사니타이저와 동일한 정책.
  // 운영 집계가 모양 한 건에 막히지 않도록 숫자 타입이 전혀 아닐 때만 거부한다.
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * 클라이언트 페이로드를 안전한 모양으로 정규화한다.
 *  - reason: 알려진 enum 값만 통과, 그 외는 거부 (null).
 *  - burstCount: 음수·NaN·부동소수는 정수로 클램프하되 최저 1 로 끌어올린다 (burst 는 항상 ≥1).
 *  - burstDurationMs: 음수·NaN·부동소수는 0 이상 정수로 클램프.
 *
 * `reason` 이 알려지지 않은 값이거나 `burstCount`/`burstDurationMs` 가 숫자가 전혀 아니면
 * null 을 돌려, 호출 측이 잘못된 페이로드로 분류해 조용히 무시하도록 한다.
 */
export function sanitizeAckBannerEventInput(input: unknown): AckBannerEventInput | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.reason !== 'string' || !VALID_DISMISS_REASONS.has(obj.reason as AckBannerDismissReason)) {
    return null;
  }
  const burstCountRaw = sanitizeNonNegInt(obj.burstCount);
  const burstDurationMs = sanitizeNonNegInt(obj.burstDurationMs);
  if (burstCountRaw === null || burstDurationMs === null) return null;
  // burst 는 정의상 항상 1 건 이상 — 0 으로 들어와도 1 로 끌어올려 평균 계산이 자연스럽도록.
  const burstCount = Math.max(1, burstCountRaw);
  return {
    reason: obj.reason as AckBannerDismissReason,
    burstCount,
    burstDurationMs,
  };
}
