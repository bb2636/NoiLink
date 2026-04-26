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
  ACK_ERROR_AUTO_DISMISS_MS,
  ACK_ERROR_COALESCE_WINDOW_MS,
  createAckErrorCoalescer,
  describeAckError,
  formatAckErrorForBanner,
  parseAckErrorString,
  subscribeAckErrorBanner,
  subscribeNativeAckErrors,
} from '../nativeAckErrors';

/**
 * 가짜 타이머 — `subscribeAckErrorBanner` 의 자동 닫힘 회귀 테스트(Task #109)에서
 * 결정적으로 시간을 흘리기 위해 setTimeout/clearTimeout 을 주입 가능한 큐로 대체한다.
 */
interface FakeTimerEntry {
  id: number;
  fireAt: number;
  fn: () => void;
}
function createFakeTimer() {
  let now = 0;
  let nextId = 1;
  const queue: FakeTimerEntry[] = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId;
      nextId += 1;
      queue.push({ id, fireAt: now + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown) => {
      const idx = queue.findIndex((e) => e.id === handle);
      if (idx >= 0) queue.splice(idx, 1);
    },
    advance(ms: number) {
      now += ms;
      // 누적 시간 안에 만료된 모든 타이머를 발화 (등록 순서 유지).
      while (true) {
        const i = queue.findIndex((e) => e.fireAt <= now);
        if (i < 0) break;
        const [entry] = queue.splice(i, 1);
        entry.fn();
      }
    },
    pending: () => queue.length,
  };
}

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

/**
 * Task #106 — 같은 사유의 ack 거부가 짧은 시간 안에 쏟아질 때 토스트가 깜빡이며
 * 사용자가 정작 사유를 못 읽는 문제를 막기 위한 코얼레싱 로직 회귀.
 *
 * 보호 정책:
 *  1. 같은 debugKey 가 윈도우 안에 5번 들어오면 banner 는 base 메시지에 `(5건)` 만 붙은 채
 *     단 한 번 갱신된 것처럼 보인다 — base/디버그 키 본문은 변하지 않는다.
 *  2. 다른 debugKey 가 들어오면 카운터는 1로 초기화된다.
 *  3. 윈도우가 만료된 뒤 같은 키가 다시 들어오면 카운터는 1로 리셋된다.
 *  4. 디버그 키가 없는 자유 문자열 에러도 사용자 메시지를 그룹 키로 묶는다.
 *  5. `subscribeAckErrorBanner` 는 ok=false 이벤트만 흘리고, 같은 키가 반복되면
 *     setBanner 에 카운터가 누적된 같은 banner 를 흘려준다.
 */
describe('createAckErrorCoalescer', () => {
  const ERR = 'ble.writeLed:field-enum@payload.colorCode: bad enum';
  const BASE = '내부 오류: ble.writeLed의 colorCode 허용되지 않은 값';
  const DBG = '[ble.writeLed:field-enum@payload.colorCode]';

  it('기본 윈도우는 ACK_ERROR_COALESCE_WINDOW_MS 와 일치한다', () => {
    expect(ACK_ERROR_COALESCE_WINDOW_MS).toBeGreaterThan(0);
  });

  it('첫 번째 호출은 카운터 표기 없이 단일 banner 를 돌려준다', () => {
    let now = 1000;
    const next = createAckErrorCoalescer({ now: () => now });
    const out = next(ERR);
    expect(out.count).toBe(1);
    expect(out.banner).toBe(`${BASE}\n${DBG}`);
    expect(out.banner).not.toContain('건)');
  });

  it('같은 debugKey 가 윈도우 안에 5번 들어오면 카운터만 누적된다', () => {
    let now = 1000;
    const next = createAckErrorCoalescer({ windowMs: 2000, now: () => now });
    const banners: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      banners.push(next(ERR).banner);
      now += 50; // 50ms 간격으로 5번 — 모두 윈도우 안.
    }
    expect(banners[0]).toBe(`${BASE}\n${DBG}`);
    expect(banners[1]).toBe(`${BASE} (2건)\n${DBG}`);
    expect(banners[4]).toBe(`${BASE} (5건)\n${DBG}`);
    // base 메시지/디버그 키 본문은 변하지 않고 카운터만 자란다 — 같은 자리 갱신.
    for (const b of banners) {
      expect(b).toContain(BASE);
      expect(b).toContain(DBG);
    }
  });

  it('다른 debugKey 가 들어오면 카운터를 1로 초기화한다', () => {
    let now = 1000;
    const next = createAckErrorCoalescer({ windowMs: 2000, now: () => now });
    next(ERR);
    next(ERR); // count=2
    const other = next('ble.connect:field-missing@payload.deviceId: x');
    expect(other.count).toBe(1);
    expect(other.banner).not.toContain('건)');
    // 다시 원래 키가 들어오면 또 1부터 시작.
    const back = next(ERR);
    expect(back.count).toBe(1);
  });

  it('윈도우가 만료되면 같은 키도 카운터를 1로 리셋한다', () => {
    let now = 1000;
    const next = createAckErrorCoalescer({ windowMs: 2000, now: () => now });
    next(ERR);
    next(ERR); // count=2 within window
    now += 5000; // 윈도우 한참 지남
    const out = next(ERR);
    expect(out.count).toBe(1);
    expect(out.banner).toBe(`${BASE}\n${DBG}`);
  });

  it('자유 문자열(디버그 키 없음)도 사용자 메시지로 묶는다', () => {
    let now = 1000;
    const next = createAckErrorCoalescer({ windowMs: 2000, now: () => now });
    const a = next('Device is not connected');
    const b = next('Device is not connected');
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(b.banner).toBe('내부 오류: Device is not connected (2건)');
    expect(b.banner).not.toContain('[');
  });

  it('빈/누락 입력도 폴백 메시지를 키로 묶는다', () => {
    let now = 1000;
    const next = createAckErrorCoalescer({ windowMs: 2000, now: () => now });
    expect(next(undefined).count).toBe(1);
    expect(next(null).count).toBe(2); // 같은 폴백 메시지 → 같은 키.
    expect(next('   ').count).toBe(3);
  });
});

describe('subscribeAckErrorBanner', () => {
  let unsub: (() => void) | null = null;
  afterEach(() => {
    if (unsub) {
      unsub();
      unsub = null;
    }
  });

  it('같은 키 5회 연속 거부는 같은 base 메시지의 카운터로 묶여 setBanner 에 흘러간다', () => {
    const setBanner = vi.fn();
    let now = 1000;
    unsub = subscribeAckErrorBanner(setBanner, { windowMs: 2000, now: () => now });

    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(
        new CustomEvent('noilink-native-ack', {
          detail: {
            id: `req-${i}`,
            ok: false,
            error: 'ble.writeLed:field-enum@payload.colorCode: bad enum',
          },
        }),
      );
      now += 50;
    }

    expect(setBanner).toHaveBeenCalledTimes(5);
    const calls = setBanner.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe(
      '내부 오류: ble.writeLed의 colorCode 허용되지 않은 값\n[ble.writeLed:field-enum@payload.colorCode]',
    );
    expect(calls[4]).toBe(
      '내부 오류: ble.writeLed의 colorCode 허용되지 않은 값 (5건)\n[ble.writeLed:field-enum@payload.colorCode]',
    );
    // ok=true 는 절대 흘리지 않는다.
    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', { detail: { id: 'ok', ok: true } }),
    );
    expect(setBanner).toHaveBeenCalledTimes(5);
  });

  /**
   * Task #109 — 같은 사유의 거부가 짧은 시간 안에 폭주한 뒤 멎으면, 사용자가 토스트를
   * 직접 닫지 않아도 마지막 거부로부터 `ACK_ERROR_AUTO_DISMISS_MS` 가 지나면 banner 가
   * 자동으로 비워진다(`setBanner(null)`).
   *
   * 보호 정책:
   *  1. 자동 닫힘 임계값 상수가 양수로 노출된다 (한 곳에서 관리).
   *  2. burst 가 끝나고 임계값이 지나면 setBanner 가 한 번 더 호출되며 인자는 null 이다.
   *  3. burst 가 이어지는 동안에는 자동 닫힘이 발화하지 않는다 — 새 거부마다 타이머가 재시작.
   *  4. 구독 해제 시 보류 중인 자동 닫힘 타이머는 취소된다 — 언마운트 후 setBanner 호출 금지.
   */
  it('자동 닫힘 임계값은 양수의 단일 상수로 노출된다', () => {
    expect(ACK_ERROR_AUTO_DISMISS_MS).toBeGreaterThan(0);
  });

  it('burst 가 멎고 자동 닫힘 임계값이 지나면 setBanner(null) 로 banner 를 비운다', () => {
    const setBanner = vi.fn();
    const timer = createFakeTimer();
    unsub = subscribeAckErrorBanner(setBanner, {
      windowMs: 2000,
      now: timer.now,
      autoDismissMs: 5000,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    // burst: 같은 키 3번 (50ms 간격) — 카운터로 묶인 단일 banner 가 갱신된다.
    for (let i = 0; i < 3; i += 1) {
      window.dispatchEvent(
        new CustomEvent('noilink-native-ack', {
          detail: {
            id: `req-${i}`,
            ok: false,
            error: 'ble.writeLed:field-enum@payload.colorCode: bad enum',
          },
        }),
      );
      timer.advance(50);
    }
    expect(setBanner).toHaveBeenCalledTimes(3);
    expect(setBanner.mock.calls[2][0]).toBe(
      '내부 오류: ble.writeLed의 colorCode 허용되지 않은 값 (3건)\n[ble.writeLed:field-enum@payload.colorCode]',
    );

    // 마지막 거부 직후 임계값 직전까지는 자동 닫힘이 발화하지 않는다.
    timer.advance(4000);
    expect(setBanner).toHaveBeenCalledTimes(3);

    // 마지막 거부 후 5000ms 경과 → 자동 닫힘 발화.
    timer.advance(1000);
    expect(setBanner).toHaveBeenCalledTimes(4);
    expect(setBanner.mock.calls[3][0]).toBeNull();
    // 큐가 비어 더 이상 발화할 타이머가 없다.
    expect(timer.pending()).toBe(0);
  });

  it('burst 가 이어지는 동안은 자동 닫힘이 발화하지 않는다 (타이머 재시작)', () => {
    const setBanner = vi.fn();
    const timer = createFakeTimer();
    unsub = subscribeAckErrorBanner(setBanner, {
      windowMs: 2000,
      now: timer.now,
      autoDismissMs: 5000,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    // 첫 거부.
    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: {
          id: 'req-0',
          ok: false,
          error: 'ble.writeLed:field-enum@payload.colorCode: bad enum',
        },
      }),
    );
    expect(setBanner).toHaveBeenCalledTimes(1);

    // 4500ms 뒤 (자동 닫힘 직전) 새 거부 — 타이머가 재시작되어야 한다.
    timer.advance(4500);
    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: {
          id: 'req-1',
          ok: false,
          error: 'ble.writeLed:field-enum@payload.colorCode: bad enum',
        },
      }),
    );
    expect(setBanner).toHaveBeenCalledTimes(2);

    // 추가 4500ms 경과 — 첫 타이머가 살아있었다면 발화했겠지만, 재시작되었으므로 아직 안 됨.
    timer.advance(4500);
    expect(setBanner).toHaveBeenCalledTimes(2);

    // 마지막 거부 후 5000ms 누적되면 비로소 발화.
    timer.advance(500);
    expect(setBanner).toHaveBeenCalledTimes(3);
    expect(setBanner.mock.calls[2][0]).toBeNull();
  });

  it('구독 해제 시 보류 중인 자동 닫힘 타이머는 취소된다', () => {
    const setBanner = vi.fn();
    const timer = createFakeTimer();
    const off = subscribeAckErrorBanner(setBanner, {
      windowMs: 2000,
      now: timer.now,
      autoDismissMs: 5000,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: {
          id: 'req-0',
          ok: false,
          error: 'ble.writeLed:field-enum@payload.colorCode: bad enum',
        },
      }),
    );
    expect(setBanner).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(1);

    off();
    // 해제 직후 큐에서 자동 닫힘 타이머가 사라져 있어야 한다 — 언마운트 후 setBanner(null) 금지.
    expect(timer.pending()).toBe(0);
    timer.advance(60_000);
    expect(setBanner).toHaveBeenCalledTimes(1);
  });

  it('autoDismissMs <= 0 이면 자동 닫힘이 비활성된다', () => {
    const setBanner = vi.fn();
    const timer = createFakeTimer();
    unsub = subscribeAckErrorBanner(setBanner, {
      windowMs: 2000,
      now: timer.now,
      autoDismissMs: 0,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    window.dispatchEvent(
      new CustomEvent('noilink-native-ack', {
        detail: {
          id: 'req-0',
          ok: false,
          error: 'ble.writeLed:field-enum@payload.colorCode: bad enum',
        },
      }),
    );
    expect(setBanner).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(0);
    timer.advance(60_000);
    expect(setBanner).toHaveBeenCalledTimes(1);
  });
});
