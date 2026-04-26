/**
 * `native.ack` 거부 사유 → 사용자 안내 변환 회귀 테스트 (Task #77)
 *
 * 보호 정책:
 *  1. 디스패처가 보내는 구조화된 형식(`type:reason@field: msg`)은 type/field/reason 으로
 *     올바르게 분해되어 한국어 안내 + 디버그 키가 만들어진다.
 *  2. 짧은 형태(`version-mismatch`)나 자유 문자열(BleManagerError.message)도
 *     원문을 잃지 않고 그대로 노출된다 — 이 경우 디버그 키는 비어있다.
 *  3. ok=true 인 ack 와 빈 detail 은 콜백이 호출되지 않는다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeAckError,
  formatAckErrorForBanner,
  parseAckErrorString,
  subscribeNativeAckErrors,
} from '../nativeAckErrors';

describe('parseAckErrorString', () => {
  it('type:reason@field: message 형식을 분해한다', () => {
    const r = parseAckErrorString('ble.connect:field-missing@payload.deviceId: ble.connect: payload.deviceId is required (string)');
    expect(r.type).toBe('ble.connect');
    expect(r.reason).toBe('field-missing');
    expect(r.field).toBe('payload.deviceId');
    expect(r.message).toContain('payload.deviceId is required');
  });

  it('field 가 없는 envelope 에러도 분해한다', () => {
    const r = parseAckErrorString('envelope:envelope-version: envelope.v must be 2 (got 1)');
    expect(r.type).toBe('envelope');
    expect(r.reason).toBe('envelope-version');
    expect(r.field).toBeUndefined();
    expect(r.message).toContain('envelope.v must be 2');
  });

  it('알려지지 않은 reason 은 자유 문자열로 보존한다', () => {
    const raw = 'version-mismatch';
    const r = parseAckErrorString(raw);
    expect(r.reason).toBeUndefined();
    expect(r.type).toBeUndefined();
    expect(r.message).toBe(raw);
    expect(r.raw).toBe(raw);
  });

  it('자유 문자열(BleManagerError.message 등)은 원문 그대로 둔다', () => {
    const raw = 'Device is not connected';
    const r = parseAckErrorString(raw);
    expect(r.reason).toBeUndefined();
    expect(r.message).toBe(raw);
  });
});

describe('describeAckError', () => {
  it('구조화된 사유는 한국어 안내 + 디버그 키를 만든다', () => {
    const { userMessage, debugKey } = describeAckError(
      'ble.connect:field-missing@payload.deviceId: ble.connect: payload.deviceId is required (string)',
    );
    expect(userMessage).toBe('내부 오류: ble.connect의 deviceId 누락');
    expect(debugKey).toBe('ble.connect:field-missing@payload.deviceId');
  });

  it('field 가 없는 envelope 에러는 type 만 노출한다', () => {
    const { userMessage, debugKey } = describeAckError('envelope:envelope-version: foo');
    expect(userMessage).toBe('내부 오류: envelope의 브릿지 버전 불일치');
    expect(debugKey).toBe('envelope:envelope-version');
  });

  it('field-enum 같은 다른 reason 도 한국어로 매핑된다', () => {
    const { userMessage, debugKey } = describeAckError('ble.writeLed:field-enum@payload.colorCode: bad enum');
    expect(userMessage).toBe('내부 오류: ble.writeLed의 colorCode 허용되지 않은 값');
    expect(debugKey).toBe('ble.writeLed:field-enum@payload.colorCode');
  });

  it('field-range (정수 범위 위반) 도 한국어로 매핑된다', () => {
    // shared 검증기는 pod=4 같은 범위 밖 값을 'field-range' 로 거부한다.
    // 모든 BridgeValidationErrorReason 이 친화적 안내로 매핑되어야 KNOWN_REASONS / REASON_KO
    // 가 shared 의 enum 과 어긋나지 않는다는 회귀 보장.
    const { userMessage, debugKey } = describeAckError(
      'ble.writeLed:field-range@payload.pod: ble.writeLed: payload.pod must be an integer in [0, 3]',
    );
    expect(userMessage).toBe('내부 오류: ble.writeLed의 pod 허용 범위 초과');
    expect(debugKey).toBe('ble.writeLed:field-range@payload.pod');
  });

  it('자유 문자열은 디버그 키 없이 원문을 그대로 보여준다', () => {
    const { userMessage, debugKey } = describeAckError('Device is not connected');
    expect(userMessage).toBe('내부 오류: Device is not connected');
    expect(debugKey).toBe('');
  });

  it('짧은 형태 (version-mismatch) 도 디버그 키 없이 통과한다', () => {
    const { userMessage, debugKey } = describeAckError('version-mismatch');
    expect(userMessage).toBe('내부 오류: version-mismatch');
    expect(debugKey).toBe('');
  });

  it('빈/누락 입력은 일반 안내로 폴백한다', () => {
    expect(describeAckError(undefined).userMessage).toContain('알 수 없는 사유');
    expect(describeAckError(null).userMessage).toContain('알 수 없는 사유');
    expect(describeAckError('   ').userMessage).toContain('알 수 없는 사유');
  });
});

describe('formatAckErrorForBanner', () => {
  it('디버그 키가 있으면 줄바꿈으로 잇는다', () => {
    const out = formatAckErrorForBanner('ble.connect:field-missing@payload.deviceId: msg');
    expect(out).toBe('내부 오류: ble.connect의 deviceId 누락\n[ble.connect:field-missing@payload.deviceId]');
  });

  it('디버그 키가 없으면 한 줄만 돌려준다', () => {
    const out = formatAckErrorForBanner('Device is not connected');
    expect(out).toBe('내부 오류: Device is not connected');
  });
});

describe('subscribeNativeAckErrors', () => {
  let unsub: (() => void) | null = null;
  afterEach(() => {
    if (unsub) {
      unsub();
      unsub = null;
    }
  });

  it('ok=false ack 만 콜백으로 흘려준다', () => {
    const handler = vi.fn();
    unsub = subscribeNativeAckErrors(handler);

    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: { id: 'req-1', ok: true },
      }),
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: { id: 'req-2', ok: false, error: 'ble.connect:field-missing@payload.deviceId: x' },
      }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({
      id: 'req-2',
      ok: false,
      error: 'ble.connect:field-missing@payload.deviceId: x',
    });
  });

  it('해제 후에는 콜백이 호출되지 않는다', () => {
    const handler = vi.fn();
    const off = subscribeNativeAckErrors(handler);
    off();
    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: { id: 'req-3', ok: false, error: 'x' },
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });
});
