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
import type { BridgeValidationErrorReason } from '@noilink/shared';

const KNOWN_REASONS = new Set<BridgeValidationErrorReason>([
  'not-object',
  'envelope-version',
  'envelope-type',
  'envelope-id',
  'unknown-type',
  'payload-missing',
  'payload-shape',
  'field-missing',
  'field-type',
  'field-enum',
  'field-range',
]);

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
 * 매칭 규칙:
 *  - 첫 ': ' 이전이 prefix(`type:reason[@field]`), 이후가 사람-읽기 message.
 *  - prefix 의 첫 ':' 로 type / 나머지 분리.
 *  - 나머지에 '@' 가 있으면 reason / field 분리.
 *  - 분리된 reason 이 알려진 enum 이 아니면 reason/field 를 비우고 원문을 message 로 둔다.
 *    (예: `BleManagerError.message`, `version-mismatch` 같은 자유 문자열은 그대로 통과)
 */
export function parseAckErrorString(raw: string): ParsedAckError {
  const trimmed = raw.trim();
  const sepIdx = trimmed.indexOf(': ');
  const prefix = sepIdx >= 0 ? trimmed.slice(0, sepIdx) : trimmed;
  const message = sepIdx >= 0 ? trimmed.slice(sepIdx + 2) : trimmed;

  const colonIdx = prefix.indexOf(':');
  if (colonIdx < 0) {
    return { message: trimmed, raw };
  }
  const type = prefix.slice(0, colonIdx);
  const tail = prefix.slice(colonIdx + 1);

  const atIdx = tail.indexOf('@');
  const reasonStr = atIdx >= 0 ? tail.slice(0, atIdx) : tail;
  const field = atIdx >= 0 ? tail.slice(atIdx + 1) : undefined;

  if (!KNOWN_REASONS.has(reasonStr as BridgeValidationErrorReason)) {
    // type 처럼 보이지만 reason 이 알려진 enum 이 아니면 자유 문자열로 취급.
    return { message: trimmed, raw };
  }

  return {
    type: type || undefined,
    field,
    reason: reasonStr as BridgeValidationErrorReason,
    message: message || trimmed,
    raw,
  };
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
