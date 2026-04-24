import { describe, it, expect } from 'vitest';
import {
  NATIVE_BRIDGE_VERSION,
  isWebToNativeMessage,
  isNativeToWebMessage,
} from './native-web-bridge.js';

// ---------------------------------------------------------------------------
// 버전 상수 잠금 — 네이티브 핸드셰이크 호환성
// ---------------------------------------------------------------------------
//
// `NATIVE_BRIDGE_VERSION`은 네이티브 셸과 웹 클라이언트가 같은 메시지 스키마
// (v2 — subscribe/write가 NoiPodCharacteristicKey 사용, BleErrorCode 구조화 등)
// 을 사용한다는 합의의 단일 진실 공급원이다. 임의로 올리면 모든 메시지가
// 조용히 false가 되어 BLE 결과/세션 응답이 통째로 무시된다.
// 의도적 bump는 네이티브 측과 동기화 필요 → 같이 갱신해야 한다는 신호로 잠근다.
//
describe('NATIVE_BRIDGE_VERSION — 핸드셰이크 상수 잠금', () => {
  it('현재 버전은 2 (v2: NoiPodCharacteristicKey + 구조화 BleErrorCode)', () => {
    expect(NATIVE_BRIDGE_VERSION).toBe(2);
  });

  it('숫자 리터럴 타입이다 (object/string로 변형되지 않음)', () => {
    expect(typeof NATIVE_BRIDGE_VERSION).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 공통 진리표 — 비-객체 / null / undefined / 잘못된 타입
// ---------------------------------------------------------------------------
//
// 두 가드는 입력이 "object 형태"가 아닐 때 어떤 경우에도 true를 반환하면 안 된다.
// 네이티브가 핸드셰이크 전 잘못된 페이로드(문자열 디버그 로그, 숫자 ack, etc.)를
// 흘려도 웹 측이 그걸 메시지로 오인하지 않아야 한다.
//
const NON_OBJECT_INPUTS: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['빈 문자열', ''],
  ['일반 문자열', 'hello'],
  ['숫자 0', 0],
  ['숫자 1', 1],
  ['boolean true', true],
  ['boolean false', false],
  ['NaN', Number.NaN],
  ['배열은 object지만 v/type/id 가 없음', []],
];

describe('isWebToNativeMessage — 비-객체/잘못된 입력은 모두 false', () => {
  for (const [label, value] of NON_OBJECT_INPUTS) {
    it(`${label} → false`, () => {
      expect(isWebToNativeMessage(value)).toBe(false);
    });
  }

  it('빈 객체 {} → false (v/type/id 모두 없음)', () => {
    expect(isWebToNativeMessage({})).toBe(false);
  });
});

describe('isNativeToWebMessage — 비-객체/잘못된 입력은 모두 false', () => {
  for (const [label, value] of NON_OBJECT_INPUTS) {
    it(`${label} → false`, () => {
      expect(isNativeToWebMessage(value)).toBe(false);
    });
  }

  it('빈 객체 {} → false (v/type 모두 없음)', () => {
    expect(isNativeToWebMessage({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isWebToNativeMessage — 필드 누락 진리표
// ---------------------------------------------------------------------------
//
// 가드 계약: { v === NATIVE_BRIDGE_VERSION, typeof type === 'string',
//            typeof id === 'string' } 세 조건을 모두 만족해야 true.
// 한 필드라도 빠지거나 타입이 다르면 false — 네이티브 ack를 잘못 처리하지 않게.
//
describe('isWebToNativeMessage — 필수 필드 누락/잘못된 타입', () => {
  it('v 누락 → false', () => {
    expect(isWebToNativeMessage({ type: 'ble.ensureReady', id: 'abc' })).toBe(false);
  });

  it('v가 다른 숫자(1, 3) → false (구버전/미래버전 호환 차단)', () => {
    expect(isWebToNativeMessage({ v: 1, type: 'ble.ensureReady', id: 'abc' })).toBe(false);
    expect(isWebToNativeMessage({ v: 3, type: 'ble.ensureReady', id: 'abc' })).toBe(false);
  });

  it('v가 문자열 "2" → false (정확한 숫자 비교)', () => {
    expect(isWebToNativeMessage({ v: '2', type: 'ble.ensureReady', id: 'abc' })).toBe(false);
  });

  it('type 누락 → false', () => {
    expect(isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, id: 'abc' })).toBe(false);
  });

  it('type이 숫자 → false', () => {
    expect(isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, type: 42, id: 'abc' })).toBe(false);
  });

  it('type이 null → false', () => {
    expect(isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, type: null, id: 'abc' })).toBe(false);
  });

  it('id 누락 → false (web→native는 항상 correlation id 필요)', () => {
    expect(isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, type: 'ble.ensureReady' })).toBe(false);
  });

  it('id가 숫자 → false', () => {
    expect(isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, type: 'ble.ensureReady', id: 1 })).toBe(
      false,
    );
  });

  it('id가 빈 문자열 "" → true (typeof만 검사; 빈값 정책은 상위 계층 책임)', () => {
    // 가드는 형식만 본다. 빈 문자열 ID 거부는 송수신측 정책으로 처리.
    expect(
      isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, type: 'ble.ensureReady', id: '' }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isWebToNativeMessage — 모든 type 분기 (진리표)
// ---------------------------------------------------------------------------
//
// 명세된 모든 web→native type이 정상 통과하는지 잠근다.
// 새 type이 추가되면 여기에도 동일한 케이스가 추가되어야 한다.
//
const WEB_TO_NATIVE_TYPES = [
  'auth.requestSession',
  'auth.persistSession',
  'auth.clearSession',
  'ble.ensureReady',
  'ble.startScan',
  'ble.stopScan',
  'ble.connect',
  'ble.disconnect',
  'ble.subscribeCharacteristic',
  'ble.unsubscribeCharacteristic',
  'ble.writeCharacteristic',
  'ble.writeLed',
  'ble.writeSession',
  'ble.writeControl',
  'ble.discoverGatt',
  'push.requestPermission',
] as const;

describe('isWebToNativeMessage — 모든 type 분기 통과', () => {
  for (const t of WEB_TO_NATIVE_TYPES) {
    it(`type="${t}" + v + id → true`, () => {
      expect(isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, id: 'req-1', type: t })).toBe(true);
    });
  }

  it('알 수 없는 type 문자열도 형식 검사는 통과 (런타임 가드는 type 값을 enum 검증하지 않음)', () => {
    // 의도적 동작: 가드는 envelope만 본다. 알 수 없는 type은 dispatch 측이 무시.
    // 이 동작이 바뀌면 (예: enum 화이트리스트로 좁히면) 이 테스트가 깨져서 알려준다.
    expect(
      isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, id: 'x', type: 'totally.fake.type' }),
    ).toBe(true);
  });

  it('payload 누락도 형식 검사는 통과 (payload 스키마는 가드 책임이 아님)', () => {
    // ble.connect 는 payload.deviceId 가 필수지만, envelope guard 단계는 통과시킨다.
    // 실제 deviceId 검증은 connect 핸들러가 수행한다 — 그 분리를 잠근다.
    expect(
      isWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, id: 'x', type: 'ble.connect' }),
    ).toBe(true);
  });

  it('payload가 부수적으로 추가 필드를 가져도 통과 (forward-compatible)', () => {
    expect(
      isWebToNativeMessage({
        v: NATIVE_BRIDGE_VERSION,
        id: 'x',
        type: 'ble.writeLed',
        payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 100, futureField: 'ok' },
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isNativeToWebMessage — 필드 누락 진리표
// ---------------------------------------------------------------------------
//
// 가드 계약: { v === NATIVE_BRIDGE_VERSION, typeof type === 'string' }.
// native→web은 broadcast 형태(예: ble.discovery)도 있으므로 id 필수 아님.
//
describe('isNativeToWebMessage — 필수 필드 누락/잘못된 타입', () => {
  it('v 누락 → false', () => {
    expect(isNativeToWebMessage({ type: 'ble.discovery' })).toBe(false);
  });

  it('v가 다른 숫자(1, 3) → false', () => {
    expect(isNativeToWebMessage({ v: 1, type: 'ble.discovery' })).toBe(false);
    expect(isNativeToWebMessage({ v: 3, type: 'ble.discovery' })).toBe(false);
  });

  it('v가 문자열 "2" → false (엄격한 동등 비교)', () => {
    expect(isNativeToWebMessage({ v: '2', type: 'ble.discovery' })).toBe(false);
  });

  it('type 누락 → false', () => {
    expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION })).toBe(false);
  });

  it('type이 숫자 → false', () => {
    expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: 42 })).toBe(false);
  });

  it('type이 null → false', () => {
    expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: null })).toBe(false);
  });

  it('id 없어도 OK (broadcast 메시지는 id 없음)', () => {
    expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: 'ble.discovery' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isNativeToWebMessage — 모든 type 분기 (진리표)
// ---------------------------------------------------------------------------
//
const NATIVE_TO_WEB_TYPES = [
  'session.update',
  'native.ack',
  'ble.discovery',
  'ble.scanState',
  'ble.connection',
  'ble.reconnect',
  'ble.notify',
  'ble.touch',
  'ble.gatt',
  'ble.error',
  'push.state',
] as const;

describe('isNativeToWebMessage — 모든 type 분기 통과', () => {
  for (const t of NATIVE_TO_WEB_TYPES) {
    it(`type="${t}" → true`, () => {
      expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: t })).toBe(true);
    });
  }

  it('알 수 없는 type 문자열도 형식 검사는 통과 (envelope guard만 수행)', () => {
    expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: 'totally.fake.type' })).toBe(
      true,
    );
  });

  it('payload 누락도 통과 (스키마는 dispatch 측 책임)', () => {
    expect(isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: 'ble.discovery' })).toBe(true);
  });

  it('id 필드가 함께 와도 통과 (native.ack는 id를 payload에 담지만 envelope 위에 있어도 OK)', () => {
    expect(
      isNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION, type: 'native.ack', id: 'extra' }),
    ).toBe(true);
  });

  it('payload에 추가 필드가 있어도 통과 (forward-compatible)', () => {
    expect(
      isNativeToWebMessage({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.connection',
        payload: { connected: null, reason: 'user', futureField: 'ok' },
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 교차 진리표 — 두 가드의 분리
// ---------------------------------------------------------------------------
//
// id가 없는 메시지는 native→web으로만 통과해야 한다. 잘못된 방향으로 dispatch
// 되면 ack 매칭이 깨지거나 송신측이 응답을 기다리며 hang 한다.
//
describe('두 가드의 분리 — id 유무에 따른 방향성', () => {
  it('id 없는 메시지: native→web만 true, web→native는 false', () => {
    const msg = { v: NATIVE_BRIDGE_VERSION, type: 'ble.discovery' };
    expect(isNativeToWebMessage(msg)).toBe(true);
    expect(isWebToNativeMessage(msg)).toBe(false);
  });

  it('id 있는 메시지: 양쪽 모두 형식상 통과 (방향은 type으로 구분)', () => {
    // envelope guard만으로는 방향을 강제하지 못한다. 이는 의도된 동작 —
    // dispatch 코드가 type 화이트리스트로 방향을 결정한다.
    const msg = { v: NATIVE_BRIDGE_VERSION, type: 'native.ack', id: 'req-1' };
    expect(isNativeToWebMessage(msg)).toBe(true);
    expect(isWebToNativeMessage(msg)).toBe(true);
  });

  it('잘못된 v: 어느 가드도 통과하지 않음', () => {
    const msg = { v: 999, type: 'ble.discovery', id: 'x' };
    expect(isNativeToWebMessage(msg)).toBe(false);
    expect(isWebToNativeMessage(msg)).toBe(false);
  });
});
