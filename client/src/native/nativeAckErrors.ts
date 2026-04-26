/**
 * `native.ack` 거부(`ok=false`) 사유 → 사용자 안내 문구 변환 (Task #77)
 *
 * 모바일 디스패처(`mobile/src/bridge/NativeBridgeDispatcher.ts`)와 웹 수신기는
 * 잘못된 web→native 메시지를 거부할 때 다음 형식의 문자열을 `native.ack.payload.error`
 * 에 실어 보낸다(콘솔 경고와 동일한 사유):
 *
 *   `${type}:${reason}@${field}: ${humanMessage}`
 *
 * 일부 케이스에서는 짧은 형태(`version-mismatch`)나 `BleManagerError.message` 같은
 * 자유 문자열이 그대로 들어올 수도 있으므로, 파서는 어떤 입력이 와도 안전하게
 * 동작해야 한다 — 알 수 없는 형태면 원문을 그대로 보존한다.
 *
 * 사용자에게는 한국어 친화적 안내(예: "내부 오류: ble.connect의 deviceId 누락")를
 * 보여주되, QA/베타 사용자가 정확히 어떤 분기가 깨졌는지 확인할 수 있도록 디버그 키
 * (`type:reason@field`)도 함께 노출한다.
 */
import {
  parseBridgeAckError,
  type AckBannerDismissReason,
  type AckBannerEventInput,
  type BridgeValidationErrorReason,
} from '@noilink/shared';
import { reportAckBannerEventFireAndForget } from '../utils/reportAckBannerEvent';

const REASON_KO: Record<BridgeValidationErrorReason, string> = {
  'not-object': '메시지 형식 오류',
  'envelope-version': '브릿지 버전 불일치',
  'envelope-type': '메시지 타입 누락',
  'envelope-id': '요청 ID 누락',
  'unknown-type': '알 수 없는 메시지',
  'payload-missing': '페이로드 누락',
  'payload-shape': '페이로드 형식 오류',
  'field-missing': '누락',
  'field-type': '타입 오류',
  'field-enum': '허용되지 않은 값',
  'field-range': '허용 범위 초과',
};

export interface ParsedAckError {
  /** 거부 메시지의 type (예: `ble.connect`, `envelope`). 알 수 없으면 `undefined`. */
  type?: string;
  /** 위반된 필드 dotted path (예: `payload.deviceId`). 없으면 `undefined`. */
  field?: string;
  /** 머신 친화적 분류 코드. 알려진 enum 값일 때만 채워진다. */
  reason?: BridgeValidationErrorReason;
  /** 디스패처가 함께 전송한 사람-읽기용 메시지(없으면 원문). */
  message: string;
  /** 원본 ack.error 문자열. */
  raw: string;
}

/**
 * `${type}:${reason}@${field}: ${message}` 형태의 ack 에러 문자열을 구조화한다.
 *
 * 실제 파싱 로직은 `@noilink/shared` 의 `parseBridgeAckError` 한 곳에서 관리한다
 * (모바일 디스패처가 사용하는 `formatBridgeValidationError` 와 라운드트립 보장).
 * 본 wrapper 는 `raw` 원문 보존 필드만 추가한다 — UI 가 디버그 키 재구성 시 사용.
 */
export function parseAckErrorString(raw: string): ParsedAckError {
  const parsed = parseBridgeAckError(raw);
  return { ...parsed, raw };
}

function shortField(field: string | undefined): string | undefined {
  if (!field) return undefined;
  // `payload.deviceId` → `deviceId` 처럼 사용자에게는 끝 단어만 보여 단순화.
  // 디버그 키에는 원문 그대로 들어가므로 디테일이 손실되진 않는다.
  const parts = field.split('.');
  return parts[parts.length - 1] || field;
}

export interface AckErrorDescription {
  /** 사용자에게 보여줄 한국어 안내 (1줄). */
  userMessage: string;
  /** QA 가 버그 리포트에 첨부할 머신 친화적 키 (`type:reason@field`). 알 수 없으면 빈 문자열. */
  debugKey: string;
}

/**
 * ack 에러 문자열을 사용자/디버그용 안내로 변환한다.
 *
 * 출력 예:
 *  - 구조화된 사유: `내부 오류: ble.connect의 deviceId 누락`
 *  - 자유 문자열  : `내부 오류: <원문>`
 *
 * `userMessage` 와 `debugKey` 는 별도 필드로 돌려준다. 호출측이 두 값을 한 줄에
 * 합쳐 보여줄지(예: SuccessBanner) 두 줄로 나눠 보여줄지 자유롭게 결정한다.
 */
export function describeAckError(error: string | undefined | null): AckErrorDescription {
  const raw = (error ?? '').trim();
  if (!raw) {
    return { userMessage: '내부 오류: 알 수 없는 사유로 요청이 거부되었습니다.', debugKey: '' };
  }

  const parsed = parseAckErrorString(raw);
  const debugKey = parsed.reason
    ? `${parsed.type ?? 'envelope'}:${parsed.reason}${parsed.field ? `@${parsed.field}` : ''}`
    : '';

  if (!parsed.reason) {
    // 자유 문자열 — 원문 그대로 노출 (BleManagerError.message 등은 이미 사람-읽기 형태).
    return { userMessage: `내부 오류: ${parsed.message}`, debugKey };
  }

  const reasonKo = REASON_KO[parsed.reason];
  const typeLabel = parsed.type && parsed.type.length > 0 ? `${parsed.type}의 ` : '';
  const fieldLabel = shortField(parsed.field);
  const subject = fieldLabel ? `${typeLabel}${fieldLabel} ` : typeLabel;
  const userMessage = `내부 오류: ${subject}${reasonKo}`.trim();

  return { userMessage, debugKey };
}

/**
 * 사용자 안내 + 디버그 키를 한 문자열로 합친다 — 토스트/배너처럼 1개 줄만 받는
 * UI 에 그대로 흘려보내기 위한 편의 함수. 디버그 키가 있으면 줄바꿈으로 잇는다.
 */
export function formatAckErrorForBanner(error: string | undefined | null): string {
  const { userMessage, debugKey } = describeAckError(error);
  return debugKey ? `${userMessage}\n[${debugKey}]` : userMessage;
}

export interface NativeAckEventPayload {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * `noilink-native-ack` 이벤트 구독 헬퍼. `ok=false` 인 ack 만 콜백으로 흘려준다.
 *
 * - 같은 ack 에러를 여러 화면에서 들으면 토스트가 중복으로 뜰 수 있으나,
 *   각 화면은 자기 라이프사이클 안에서만 구독/해제하므로 실제로는 활성 화면 1곳에서만
 *   소비된다 (예: TrainingSessionPlay 마운트 중에는 Device 가 아님).
 * - 핸들러는 동기적으로 호출되며 예외는 호출측이 흡수해야 한다.
 */
export function subscribeNativeAckErrors(
  handler: (payload: NativeAckEventPayload) => void,
): () => void {
  const onAck = (e: Event) => {
    const detail = (e as CustomEvent<NativeAckEventPayload>).detail;
    if (!detail || detail.ok) return;
    handler(detail);
  };
  window.addEventListener('noilink-native-ack', onAck as EventListener);
  return () => window.removeEventListener('noilink-native-ack', onAck as EventListener);
}

/**
 * 같은 사유의 ack 거부가 짧은 시간 안에 연속으로 들어올 때 토스트가
 * 깜빡이며 사용자가 정작 사유를 못 읽는 문제를 막기 위한 코얼레싱 윈도우 (Task #106).
 *
 * 예: 트레이닝 도중 잘못된 `ble.writeLed:field-enum@payload.colorCode` 가
 * 50ms 간격으로 20번 거부되면, 토스트 메시지는 매번 새로 뜨지 않고 마지막
 * 한 번만 `(20건)` 카운터를 올려 표시한다.
 */
export const ACK_ERROR_COALESCE_WINDOW_MS = 2000;

export interface CoalescedAckBanner {
  /** SuccessBanner.message 에 그대로 흘려보낼 1줄(또는 2줄) 문자열. */
  banner: string;
  /** 윈도우 안에서 같은 키가 누적된 횟수 (>=1). 1이면 카운터 표기는 생략. */
  count: number;
  /** 코얼레싱 그룹 키. 디버그 키가 있으면 그것, 없으면 사용자 메시지를 사용. */
  key: string;
}

export interface AckErrorCoalescerOptions {
  /** 같은 키가 이 시간 안에 다시 들어오면 카운터만 올리고 같은 토스트를 갱신 (기본 2000ms). */
  windowMs?: number;
  /** 테스트 주입용 시계. 기본 `Date.now`. */
  now?: () => number;
}

/**
 * ack 거부 스트림을 받아 같은 `debugKey` 가 윈도우 안에 반복되면 카운터를 누적해
 * 한 토스트로 묶어 돌려주는 상태 머신을 만든다.
 *
 * - 디버그 키가 비어 있는 자유 문자열 에러(BleManagerError 등)도 사용자 메시지를
 *   그룹 키로 삼아 같은 메시지가 쏟아지면 묶는다.
 * - 다른 키가 들어오거나 윈도우가 만료되면 카운터를 1로 초기화한다.
 * - 호출측은 매 호출마다 같은 `setBanner` 에 결과를 그대로 흘리면 된다 — UI 상에서는
 *   같은 토스트가 그 자리에서 카운터만 올라가는 것처럼 보인다.
 */
export function createAckErrorCoalescer(opts: AckErrorCoalescerOptions = {}) {
  const windowMs = opts.windowMs ?? ACK_ERROR_COALESCE_WINDOW_MS;
  const now = opts.now ?? Date.now;

  let lastKey: string | null = null;
  let lastTs = 0;
  let count = 0;

  return function next(error: string | null | undefined): CoalescedAckBanner {
    const { userMessage, debugKey } = describeAckError(error);
    const key = debugKey || userMessage;
    const t = now();
    if (lastKey === key && t - lastTs <= windowMs) {
      count += 1;
    } else {
      count = 1;
    }
    lastKey = key;
    lastTs = t;

    const suffix = count > 1 ? ` (${count}건)` : '';
    const banner = debugKey
      ? `${userMessage}${suffix}\n[${debugKey}]`
      : `${userMessage}${suffix}`;
    return { banner, count, key };
  };
}

/**
 * 마지막 ack 거부 후 새 거부가 들어오지 않은 채 이 시간이 지나면 banner 를
 * 자동으로 닫아 (`setBanner(null)`) 화면을 비워준다 (Task #109).
 *
 * Task #106 의 카운터 표기 덕분에 burst 중에는 같은 토스트 자리에서 `(N건)` 만
 * 갱신되지만, burst 가 끝난 뒤 사용자가 토스트를 닫지 않으면 마지막 카운터가
 * 화면에 계속 남는다. burst 가 식었음을 사용자가 인지할 수 있도록 일정 시간
 * 동안 추가 거부가 없으면 알아서 사라지게 만든다.
 */
export const ACK_ERROR_AUTO_DISMISS_MS = 5000;

export interface AckBannerSubscriptionOptions extends AckErrorCoalescerOptions {
  /**
   * 마지막 ack 거부 후 새 거부 없이 이 시간이 지나면 `setBanner(null)` 로 자동 닫는다
   * (기본 `ACK_ERROR_AUTO_DISMISS_MS`). 0 이하면 자동 닫힘 비활성.
   */
  autoDismissMs?: number;
  /**
   * 테스트 주입용 타이머. 기본 `setTimeout` / `clearTimeout`. `now` 와 마찬가지로
   * 가짜 시계 환경에서 자동 닫힘 회귀 테스트를 결정적으로 돌리기 위한 훅.
   */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /**
   * burst 가 끝난 시점의 운영 텔레메트리를 흘려줄 수신기 (Task #116).
   * 기본값은 `reportAckBannerEventFireAndForget` — 서버 `POST /api/metrics/ack-banner`.
   * 테스트는 빈 함수나 spy 를 주입해 네트워크 호출 없이 호출 모양만 검증할 수 있다.
   */
  onTelemetry?: (event: AckBannerEventInput) => void;
}

/**
 * `subscribeAckErrorBanner` 가 돌려주는 핸들. unsubscribe 외에 외부 닫힘 알림 API 를 함께 노출한다.
 *
 * - `unsubscribe()`: useEffect cleanup 에서 호출. 보류 중인 자동 닫힘 타이머도 함께 취소된다.
 * - `notifyDismissed()`: 페이지가 SuccessBanner.onClose 등으로 banner 를 외부에서 닫을 때
 *   호출한다. 자동 닫힘 타이머가 살아있다면 취소되고, burst 가 활성 중이면
 *   `user-dismiss` 텔레메트리가 한 건 흘러간다. 이미 자동 닫힘이 발화한 뒤 호출되면
 *   조용히 무시된다 (중복 보고 금지).
 */
export interface AckBannerSubscription {
  unsubscribe(): void;
  notifyDismissed(): void;
}

/**
 * `subscribeNativeAckErrors` + `createAckErrorCoalescer` 조합 헬퍼.
 *
 * Device / DeviceAdd / TrainingSessionPlay 가 동일하게 사용하는 패턴 — 거부 사유를
 * `setBanner` 로 흘리되 같은 키가 짧은 시간 안에 쏟아지면 카운터만 올린다.
 *
 * 추가로, 마지막 거부 후 `autoDismissMs` 동안 새 거부가 없으면 `setBanner(null)` 을
 * 호출해 banner 를 자동으로 닫는다 (Task #109). 새 거부가 들어올 때마다 타이머는
 * 다시 시작되므로, burst 가 이어지는 동안은 토스트가 닫히지 않는다.
 *
 * Task #116 — burst 가 끝나는 시점(자동 닫힘 발화 / 외부 닫힘 알림 / 구독 해제) 마다
 * `onTelemetry` 로 한 건의 익명 통계가 흘러간다. 운영자는 자동 닫힘 vs 사용자 닫힘
 * 비율과 burst 평균 길이를 보고 `ACK_ERROR_AUTO_DISMISS_MS` 임계값 튜닝의 근거로 쓴다.
 */
export function subscribeAckErrorBanner(
  setBanner: (banner: string | null) => void,
  opts?: AckBannerSubscriptionOptions,
): AckBannerSubscription {
  const next = createAckErrorCoalescer(opts);
  const autoDismissMs = opts?.autoDismissMs ?? ACK_ERROR_AUTO_DISMISS_MS;
  const setTimer =
    opts?.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    opts?.clearTimer ??
    ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onTelemetry = opts?.onTelemetry ?? reportAckBannerEventFireAndForget;
  const now = opts?.now ?? Date.now;

  let dismissHandle: unknown = null;
  // burst 활성 상태 — 첫 거부가 들어온 시점부터 닫힘이 보고될 때까지 유지.
  // 같은 burst 안에 여러 텔레메트리가 중복으로 흘러가지 않도록 게이트 역할도 한다.
  let burstStartedAt: number | null = null;
  let burstCount = 0;

  const cancelDismiss = () => {
    if (dismissHandle != null) {
      clearTimer(dismissHandle);
      dismissHandle = null;
    }
  };

  const reportBurstClose = (reason: AckBannerDismissReason) => {
    if (burstStartedAt === null) return; // 활성 burst 가 없으면 보고할 것도 없다.
    const event: AckBannerEventInput = {
      reason,
      burstCount,
      burstDurationMs: Math.max(0, now() - burstStartedAt),
    };
    burstStartedAt = null;
    burstCount = 0;
    try {
      onTelemetry(event);
    } catch {
      // 텔레메트리 실패가 토스트/구독 해제 흐름을 가로막아선 안 된다.
    }
  };

  const off = subscribeNativeAckErrors((payload) => {
    setBanner(next(payload.error).banner);
    cancelDismiss();
    if (burstStartedAt === null) {
      // 새 burst 시작 — 첫 거부 시각을 기록하고 카운터를 1 로 초기화.
      burstStartedAt = now();
      burstCount = 1;
    } else {
      // 같은 burst 안에서 거부가 추가됨 — 카운터만 증가, 시작 시각은 유지.
      burstCount += 1;
    }
    if (autoDismissMs > 0) {
      dismissHandle = setTimer(() => {
        dismissHandle = null;
        setBanner(null);
        reportBurstClose('auto-dismiss');
      }, autoDismissMs);
    }
  });

  return {
    unsubscribe: () => {
      cancelDismiss();
      // 활성 burst 가 있으면 unmount 라벨로 마감 — "burst 가 끝났는데 자동 닫힘이
      // 발화하지 못한" 비율을 추적하기 위함. 활성 burst 가 없으면 조용히 끝낸다.
      reportBurstClose('unmount');
      off();
    },
    notifyDismissed: () => {
      // 외부에서 banner 가 먼저 닫힘 — 보류 중인 자동 닫힘은 취소하고 한 건 보고.
      cancelDismiss();
      reportBurstClose('user-dismiss');
    },
  };
}
