import { describe, it, expect } from 'vitest';
import {
  BRIDGE_VALIDATION_ERROR_REASONS,
  NATIVE_BRIDGE_VERSION,
  formatBridgeValidationError,
  isWebToNativeMessage,
  isNativeToWebMessage,
  parseBridgeAckError,
  validateWebToNativeMessage,
  validateNativeToWebMessage,
  type BridgeValidationError,
  type BridgeValidationErrorReason,
} from './native-web-bridge.js';
import {
  BPM_MAX,
  BPM_MIN,
  LEVEL_MAX,
  LEVEL_MIN,
  MAX_SESSION_SEC,
  POD_INDEX_MAX,
  POD_INDEX_MIN,
  U16_MAX,
  U32_MAX,
  U8_MAX,
} from './ble-protocol.js';

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
// isWebToNativeMessage — envelope 필드 진리표
// ---------------------------------------------------------------------------
//
// 가드 envelope 계약: { v === NATIVE_BRIDGE_VERSION,
//                       typeof type === 'string',
//                       typeof id === 'string' } 세 조건을 모두 만족해야
// payload 검증으로 진입한다. 한 필드라도 빠지거나 타입이 다르면 false —
// 네이티브 ack를 잘못 처리하지 않게.
//
describe('isWebToNativeMessage — envelope 누락/잘못된 타입', () => {
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
// isWebToNativeMessage — type 별 payload 진리표 (Task #30)
// ---------------------------------------------------------------------------
//
// 각 web→native type 의 정상/비정상 payload 를 명세로 박아둔다.
// 새 type 이 추가되면 여기 truth table 에 케이스가 추가되어야 한다.
// `totally.fake.type` 같은 알 수 없는 type 도 unknown-type 으로 거부된다.
//
type ValidCase = { label: string; msg: Record<string, unknown> };
type InvalidCase = {
  label: string;
  msg: Record<string, unknown>;
  expectedType?: string;
  expectedField?: string;
  expectedReason?: BridgeValidationError['reason'];
};

const baseEnv = (type: string, id = 'req-1') => ({ v: NATIVE_BRIDGE_VERSION, id, type });

const VALID_WEB_TO_NATIVE: ValidCase[] = [
  { label: 'auth.requestSession (no payload)', msg: { ...baseEnv('auth.requestSession') } },
  { label: 'auth.requestSession (empty payload)', msg: { ...baseEnv('auth.requestSession'), payload: {} } },
  {
    label: 'auth.persistSession (token+userId)',
    msg: { ...baseEnv('auth.persistSession'), payload: { token: 't', userId: 'u' } },
  },
  {
    label: 'auth.persistSession (with displayName)',
    msg: { ...baseEnv('auth.persistSession'), payload: { token: 't', userId: 'u', displayName: 'd' } },
  },
  { label: 'auth.clearSession', msg: { ...baseEnv('auth.clearSession') } },
  { label: 'ble.ensureReady', msg: { ...baseEnv('ble.ensureReady') } },
  { label: 'ble.startScan (no payload)', msg: { ...baseEnv('ble.startScan') } },
  {
    label: 'ble.startScan (with filter+timeoutMs)',
    msg: {
      ...baseEnv('ble.startScan'),
      payload: { filter: { namePrefix: 'NoiPod', serviceUUIDs: ['uuid-1'] }, timeoutMs: 5000 },
    },
  },
  { label: 'ble.stopScan', msg: { ...baseEnv('ble.stopScan') } },
  { label: 'ble.connect (deviceId)', msg: { ...baseEnv('ble.connect'), payload: { deviceId: 'dev-1' } } },
  { label: 'ble.disconnect (no payload)', msg: { ...baseEnv('ble.disconnect') } },
  {
    label: 'ble.disconnect (with deviceId)',
    msg: { ...baseEnv('ble.disconnect'), payload: { deviceId: 'dev-1' } },
  },
  {
    label: 'ble.subscribeCharacteristic (key=notify)',
    msg: {
      ...baseEnv('ble.subscribeCharacteristic'),
      payload: { subscriptionId: 's1', key: 'notify' },
    },
  },
  {
    label: 'ble.unsubscribeCharacteristic',
    msg: { ...baseEnv('ble.unsubscribeCharacteristic'), payload: { subscriptionId: 's1' } },
  },
  {
    label: 'ble.writeCharacteristic (key=write)',
    msg: {
      ...baseEnv('ble.writeCharacteristic'),
      payload: { key: 'write', base64Value: 'AAAA' },
    },
  },
  {
    label: 'ble.writeCharacteristic (mode=withResponse)',
    msg: {
      ...baseEnv('ble.writeCharacteristic'),
      payload: { key: 'write', base64Value: 'AAAA', mode: 'withResponse' },
    },
  },
  {
    label: 'ble.writeLed (minimal RED)',
    msg: { ...baseEnv('ble.writeLed'), payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 100 } },
  },
  {
    label: 'ble.writeLed (OFF color 0xFF + onMs=0)',
    msg: { ...baseEnv('ble.writeLed'), payload: { tickId: 1, pod: 0, colorCode: 0xff, onMs: 0 } },
  },
  {
    label: 'ble.writeLed (pod=POD_INDEX_MAX 경계값 통과)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: POD_INDEX_MAX, colorCode: 1, onMs: 100 },
    },
  },
  {
    label: 'ble.writeLed (tickId=U32_MAX, onMs=U16_MAX, flags=U8_MAX 상한 경계 통과)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: {
        tickId: U32_MAX,
        pod: 0,
        colorCode: 1,
        onMs: U16_MAX,
        flags: U8_MAX,
      },
    },
  },
  {
    label: 'ble.writeLed (tickId=0, onMs=0, flags=0 하한 경계 통과)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 0, pod: 0, colorCode: 0xff, onMs: 0, flags: 0 },
    },
  },
  {
    label: 'ble.writeSession',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 60, level: 1, phase: 0, durationSec: 30 },
    },
  },
  {
    label: 'ble.writeSession (level=LEVEL_MAX, bpm=BPM_MAX, durationSec=MAX_SESSION_SEC 경계 통과)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: {
        bpm: BPM_MAX,
        level: LEVEL_MAX,
        phase: 0,
        durationSec: MAX_SESSION_SEC,
      },
    },
  },
  {
    label: 'ble.writeSession (flags=U8_MAX 상한 경계 통과)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: 30, flags: U8_MAX },
    },
  },
  {
    label: 'ble.writeSession (flags=0 하한 경계 통과)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: 30, flags: 0 },
    },
  },
  {
    label: 'ble.writeControl (START=0)',
    msg: { ...baseEnv('ble.writeControl'), payload: { cmd: 0 } },
  },
  { label: 'ble.discoverGatt', msg: { ...baseEnv('ble.discoverGatt') } },
  { label: 'ble.reconnect.now', msg: { ...baseEnv('ble.reconnect.now') } },
  { label: 'push.requestPermission', msg: { ...baseEnv('push.requestPermission') } },
];

const INVALID_WEB_TO_NATIVE: InvalidCase[] = [
  {
    label: '알 수 없는 type → unknown-type (envelope 통과 후 type 화이트리스트에서 거부)',
    msg: { ...baseEnv('totally.fake.type') },
    expectedType: 'totally.fake.type',
    expectedReason: 'unknown-type',
  },
  {
    label: 'auth.persistSession: payload 누락 → payload-missing',
    msg: { ...baseEnv('auth.persistSession') },
    expectedType: 'auth.persistSession',
    expectedField: 'payload',
    expectedReason: 'payload-missing',
  },
  {
    label: 'auth.persistSession: token 누락 → field-missing',
    msg: { ...baseEnv('auth.persistSession'), payload: { userId: 'u' } },
    expectedType: 'auth.persistSession',
    expectedField: 'payload.token',
    expectedReason: 'field-missing',
  },
  {
    label: 'auth.persistSession: token이 숫자 → field-type',
    msg: { ...baseEnv('auth.persistSession'), payload: { token: 1, userId: 'u' } },
    expectedType: 'auth.persistSession',
    expectedField: 'payload.token',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.connect: payload 누락 → payload-missing (조용한 실패 방지)',
    msg: { ...baseEnv('ble.connect') },
    expectedType: 'ble.connect',
    expectedField: 'payload',
    expectedReason: 'payload-missing',
  },
  {
    label: 'ble.connect: deviceId 누락 → field-missing',
    msg: { ...baseEnv('ble.connect'), payload: {} },
    expectedType: 'ble.connect',
    expectedField: 'payload.deviceId',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.connect: deviceId 숫자 → field-type',
    msg: { ...baseEnv('ble.connect'), payload: { deviceId: 42 } },
    expectedType: 'ble.connect',
    expectedField: 'payload.deviceId',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.disconnect: payload는 객체여야 함 → payload-shape',
    msg: { ...baseEnv('ble.disconnect'), payload: 'gone' },
    expectedType: 'ble.disconnect',
    expectedField: 'payload',
    expectedReason: 'payload-shape',
  },
  {
    label: 'ble.subscribeCharacteristic: subscriptionId 누락',
    msg: { ...baseEnv('ble.subscribeCharacteristic'), payload: { key: 'notify' } },
    expectedType: 'ble.subscribeCharacteristic',
    expectedField: 'payload.subscriptionId',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.subscribeCharacteristic: key가 알려지지 않은 값 → field-enum',
    msg: {
      ...baseEnv('ble.subscribeCharacteristic'),
      payload: { subscriptionId: 's', key: 'bogus' },
    },
    expectedType: 'ble.subscribeCharacteristic',
    expectedField: 'payload.key',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.writeCharacteristic: base64Value 누락',
    msg: { ...baseEnv('ble.writeCharacteristic'), payload: { key: 'write' } },
    expectedType: 'ble.writeCharacteristic',
    expectedField: 'payload.base64Value',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.writeCharacteristic: mode가 잘못된 값 → field-enum',
    msg: {
      ...baseEnv('ble.writeCharacteristic'),
      payload: { key: 'write', base64Value: 'AAAA', mode: 'wishful' },
    },
    expectedType: 'ble.writeCharacteristic',
    expectedField: 'payload.mode',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.writeLed: onMs 누락 → field-missing',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.onMs',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.writeLed: 알려지지 않은 colorCode → field-enum',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 99, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.colorCode',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.writeLed: tickId가 NaN → field-type (Number.isFinite 사용)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: Number.NaN, pod: 0, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.tickId',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeSession: 알려지지 않은 phase → field-enum',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 60, level: 1, phase: 99, durationSec: 30 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.phase',
    expectedReason: 'field-enum',
  },
  // -- Task #68 — pod 0..3, level 1..5, bpm/durationSec bounds ----------------
  {
    label: 'ble.writeLed: pod=-1 → field-range (POD_INDEX_MIN-1)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: POD_INDEX_MIN - 1, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.pod',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: pod=4 → field-range (POD_INDEX_MAX+1)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: POD_INDEX_MAX + 1, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.pod',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: pod=1.5 → field-type (정수가 아니면 byte 로 truncate 위험)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 1.5, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.pod',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeSession: level=0 → field-range (LEVEL_MIN-1)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: LEVEL_MIN - 1, phase: 0, durationSec: 30 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.level',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: level=6 → field-range (LEVEL_MAX+1)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: LEVEL_MAX + 1, phase: 0, durationSec: 30 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.level',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: bpm=BPM_MIN-1 → field-range',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: BPM_MIN - 1, level: 1, phase: 0, durationSec: 30 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.bpm',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: bpm=BPM_MAX+1 → field-range',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: BPM_MAX + 1, level: 1, phase: 0, durationSec: 30 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.bpm',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: bpm=120.5 → field-type (정수만 허용)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 120.5, level: 1, phase: 0, durationSec: 30 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.bpm',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeSession: durationSec=MAX_SESSION_SEC+1 → field-range (5분 상한)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: MAX_SESSION_SEC + 1 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.durationSec',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: durationSec=-1 → field-range (음수)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: -1 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.durationSec',
    expectedReason: 'field-range',
  },
  // -- Task #84 — tickId(u32) / onMs(u16) / flags(u8) bounds ------------------
  // 펌웨어 byte 로 silently truncate 되기 전에 브리지가 잡아 다른 tick / 0ms LED /
  // 다른 비트 set 으로 오인되지 않게 막는다.
  {
    label: 'ble.writeLed: tickId=-1 → field-range (u32 음수)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: -1, pod: 0, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.tickId',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: tickId=U32_MAX+1 → field-range (writeU32LE 가 다른 tick 으로 truncate)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: U32_MAX + 1, pod: 0, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.tickId',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: tickId=1.5 → field-type (소수면 byte 로 truncate 위험)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1.5, pod: 0, colorCode: 1, onMs: 100 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.tickId',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeLed: onMs=-1 → field-range (u16 음수)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: -1 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.onMs',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: onMs=U16_MAX+1 → field-range (writeU16LE 가 0 으로 truncate → 즉시 OFF 오인)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: U16_MAX + 1 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.onMs',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: onMs=120.5 → field-type (정수만 허용)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 120.5 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.onMs',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeLed: onMs=NaN → field-type',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: Number.NaN },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.onMs',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeLed: flags=-1 → field-range (u8 음수)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 100, flags: -1 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.flags',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: flags=U8_MAX+1 → field-range (다른 비트 set 위험)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 100, flags: U8_MAX + 1 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.flags',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeLed: flags=0.5 → field-type (정수만 허용)',
    msg: {
      ...baseEnv('ble.writeLed'),
      payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 100, flags: 0.5 },
    },
    expectedType: 'ble.writeLed',
    expectedField: 'payload.flags',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeSession: flags=-1 → field-range (u8 음수)',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: 30, flags: -1 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.flags',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: flags=U8_MAX+1 → field-range',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: 30, flags: U8_MAX + 1 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.flags',
    expectedReason: 'field-range',
  },
  {
    label: 'ble.writeSession: flags=1.5 → field-type',
    msg: {
      ...baseEnv('ble.writeSession'),
      payload: { bpm: 100, level: 1, phase: 0, durationSec: 30, flags: 1.5 },
    },
    expectedType: 'ble.writeSession',
    expectedField: 'payload.flags',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.writeControl: 알려지지 않은 cmd → field-enum',
    msg: { ...baseEnv('ble.writeControl'), payload: { cmd: 99 } },
    expectedType: 'ble.writeControl',
    expectedField: 'payload.cmd',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.startScan: timeoutMs가 문자열 → field-type',
    msg: { ...baseEnv('ble.startScan'), payload: { timeoutMs: 'soon' } },
    expectedType: 'ble.startScan',
    expectedField: 'payload.timeoutMs',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.startScan: filter.serviceUUIDs 가 string[] 아님',
    msg: { ...baseEnv('ble.startScan'), payload: { filter: { serviceUUIDs: [1, 2] } } },
    expectedType: 'ble.startScan',
    expectedField: 'payload.filter.serviceUUIDs[0]',
    expectedReason: 'field-type',
  },
];

describe('isWebToNativeMessage — 정상 payload 진리표', () => {
  for (const c of VALID_WEB_TO_NATIVE) {
    it(`${c.label} → true`, () => {
      expect(isWebToNativeMessage(c.msg)).toBe(true);
      const r = validateWebToNativeMessage(c.msg);
      expect(r.ok).toBe(true);
    });
  }

  it('payload에 추가 필드가 있어도 통과 (forward-compatible)', () => {
    expect(
      isWebToNativeMessage({
        ...baseEnv('ble.writeLed'),
        payload: { tickId: 1, pod: 0, colorCode: 1, onMs: 100, futureField: 'ok' },
      }),
    ).toBe(true);
  });
});

describe('isWebToNativeMessage — 잘못된 payload 진리표', () => {
  for (const c of INVALID_WEB_TO_NATIVE) {
    it(`${c.label} → false`, () => {
      expect(isWebToNativeMessage(c.msg)).toBe(false);
      const r = validateWebToNativeMessage(c.msg);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        if (c.expectedType !== undefined) expect(r.error.type).toBe(c.expectedType);
        if (c.expectedField !== undefined) expect(r.error.field).toBe(c.expectedField);
        if (c.expectedReason !== undefined) expect(r.error.reason).toBe(c.expectedReason);
        expect(typeof r.error.message).toBe('string');
        expect(r.error.message.length).toBeGreaterThan(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// isNativeToWebMessage — envelope 필드 진리표
// ---------------------------------------------------------------------------
//
// 가드 envelope 계약: { v === NATIVE_BRIDGE_VERSION, typeof type === 'string' }.
// native→web은 broadcast 형태(예: ble.discovery)도 있으므로 id 필수 아님.
//
describe('isNativeToWebMessage — envelope 누락/잘못된 타입', () => {
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
});

// ---------------------------------------------------------------------------
// isNativeToWebMessage — type 별 payload 진리표 (Task #30)
// ---------------------------------------------------------------------------
//
const baseNativeEnv = (type: string) => ({ v: NATIVE_BRIDGE_VERSION, type });

const validDevice = { id: 'dev-1', name: 'NoiPod', rssi: -60, lastSeenAt: 12345 };

const validTouch = {
  type: 'TOUCH' as const,
  tickId: 1,
  pod: 0,
  channel: 0,
  deltaMs: -10,
  deviceDeltaValid: true,
};

const VALID_NATIVE_TO_WEB: ValidCase[] = [
  {
    label: 'session.update (모두 string)',
    msg: {
      ...baseNativeEnv('session.update'),
      payload: { token: 't', userId: 'u', displayName: 'd' },
    },
  },
  {
    label: 'session.update (모두 null = 로그아웃 알림)',
    msg: {
      ...baseNativeEnv('session.update'),
      payload: { token: null, userId: null, displayName: null },
    },
  },
  {
    label: 'native.ack (성공)',
    msg: { ...baseNativeEnv('native.ack'), payload: { id: 'req-1', ok: true } },
  },
  {
    label: 'native.ack (실패 + error)',
    msg: { ...baseNativeEnv('native.ack'), payload: { id: 'req-1', ok: false, error: 'bad' } },
  },
  {
    label: 'ble.discovery',
    msg: { ...baseNativeEnv('ble.discovery'), payload: { device: validDevice } },
  },
  {
    label: 'ble.discovery (rssi=null)',
    msg: {
      ...baseNativeEnv('ble.discovery'),
      payload: { device: { id: 'dev-1', name: null, rssi: null, lastSeenAt: 1 } },
    },
  },
  {
    label: 'ble.scanState (true)',
    msg: { ...baseNativeEnv('ble.scanState'), payload: { scanning: true } },
  },
  {
    label: 'ble.connection (connected)',
    msg: { ...baseNativeEnv('ble.connection'), payload: { connected: validDevice } },
  },
  {
    label: 'ble.connection (null + reason=user)',
    msg: {
      ...baseNativeEnv('ble.connection'),
      payload: { connected: null, reason: 'user' },
    },
  },
  {
    label: 'ble.reconnect (with nextDelayMs)',
    msg: {
      ...baseNativeEnv('ble.reconnect'),
      payload: { deviceId: 'dev-1', attempt: 1, maxAttempts: 5, nextDelayMs: 1000 },
    },
  },
  {
    label: 'ble.reconnect (마지막 시도 — nextDelayMs 생략)',
    msg: {
      ...baseNativeEnv('ble.reconnect'),
      payload: { deviceId: 'dev-1', attempt: 5, maxAttempts: 5 },
    },
  },
  {
    label: 'ble.notify (touch 없음)',
    msg: {
      ...baseNativeEnv('ble.notify'),
      payload: { subscriptionId: 's1', key: 'notify', base64Value: 'AAAA' },
    },
  },
  {
    label: 'ble.notify (touch 함께)',
    msg: {
      ...baseNativeEnv('ble.notify'),
      payload: {
        subscriptionId: 's1',
        key: 'notify',
        base64Value: 'AAAA',
        touch: validTouch,
      },
    },
  },
  {
    label: 'ble.touch',
    msg: { ...baseNativeEnv('ble.touch'), payload: { touch: validTouch } },
  },
  {
    label: 'ble.gatt (services + selected=null)',
    msg: {
      ...baseNativeEnv('ble.gatt'),
      payload: {
        services: [
          {
            uuid: 'svc-1',
            chars: [
              {
                uuid: 'ch-1',
                isReadable: true,
                isWritableWithResponse: true,
                isWritableWithoutResponse: false,
                isNotifiable: true,
                isIndicatable: false,
              },
            ],
          },
        ],
        selected: null,
      },
    },
  },
  {
    label: 'ble.gatt (selected 객체)',
    msg: {
      ...baseNativeEnv('ble.gatt'),
      payload: {
        services: [],
        selected: { service: 'svc', txCharacteristic: 'tx', rxCharacteristic: 'rx' },
      },
    },
  },
  {
    label: 'ble.error (필수만)',
    msg: {
      ...baseNativeEnv('ble.error'),
      payload: { code: 'CONNECT_FAIL', message: 'failed' },
    },
  },
  {
    label: 'ble.error (id+deviceId+action 포함)',
    msg: {
      ...baseNativeEnv('ble.error'),
      payload: {
        id: 'req-1',
        code: 'WRITE_FAIL',
        message: 'gatt 13',
        deviceId: 'dev-1',
        action: 'write',
      },
    },
  },
  {
    label: 'push.state (granted)',
    msg: { ...baseNativeEnv('push.state'), payload: { status: 'granted' } },
  },
  {
    // 네이티브 셸의 네트워크 복구 알림 — payload 없이 broadcast 형태로 와도 통과.
    // 결과 전송 큐의 즉시 drain 트리거 진입점이므로, validator 가 reject 하면
    // WebView 환경에서 trigger 가 통째로 무시된다.
    label: 'network.online (payload 없음)',
    msg: { ...baseNativeEnv('network.online') },
  },
  {
    label: 'network.online (빈 payload 객체 — forward-compatible)',
    msg: { ...baseNativeEnv('network.online'), payload: {} },
  },
];

const INVALID_NATIVE_TO_WEB: InvalidCase[] = [
  {
    label: '알 수 없는 type → unknown-type',
    msg: { ...baseNativeEnv('totally.fake.type') },
    expectedType: 'totally.fake.type',
    expectedReason: 'unknown-type',
  },
  {
    label: 'session.update: payload 누락',
    msg: { ...baseNativeEnv('session.update') },
    expectedType: 'session.update',
    expectedField: 'payload',
    expectedReason: 'payload-missing',
  },
  {
    label: 'session.update: token 필드 자체가 없음 (string|null 둘 다 명시 필요)',
    msg: {
      ...baseNativeEnv('session.update'),
      payload: { userId: null, displayName: null },
    },
    expectedType: 'session.update',
    expectedField: 'payload.token',
    expectedReason: 'field-missing',
  },
  {
    label: 'session.update: userId가 숫자 → field-type',
    msg: {
      ...baseNativeEnv('session.update'),
      payload: { token: null, userId: 1, displayName: null },
    },
    expectedType: 'session.update',
    expectedField: 'payload.userId',
    expectedReason: 'field-type',
  },
  {
    label: 'native.ack: ok 누락',
    msg: { ...baseNativeEnv('native.ack'), payload: { id: 'req-1' } },
    expectedType: 'native.ack',
    expectedField: 'payload.ok',
    expectedReason: 'field-missing',
  },
  {
    label: 'native.ack: ok가 truthy 문자열 → field-type (boolean coercion 차단)',
    msg: { ...baseNativeEnv('native.ack'), payload: { id: 'req-1', ok: 'yes' } },
    expectedType: 'native.ack',
    expectedField: 'payload.ok',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.discovery: device 누락',
    msg: { ...baseNativeEnv('ble.discovery'), payload: {} },
    expectedType: 'ble.discovery',
    expectedField: 'payload.device',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.discovery: device.id 누락',
    msg: {
      ...baseNativeEnv('ble.discovery'),
      payload: { device: { name: null, rssi: null, lastSeenAt: 1 } },
    },
    expectedType: 'ble.discovery',
    expectedField: 'payload.device.id',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.scanState: scanning이 boolean 아님',
    msg: { ...baseNativeEnv('ble.scanState'), payload: { scanning: 1 } },
    expectedType: 'ble.scanState',
    expectedField: 'payload.scanning',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.connection: connected 키 자체가 없음 (object|null 명시 필요)',
    msg: { ...baseNativeEnv('ble.connection'), payload: {} },
    expectedType: 'ble.connection',
    expectedField: 'payload.connected',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.connection: 알려지지 않은 reason → field-enum',
    msg: {
      ...baseNativeEnv('ble.connection'),
      payload: { connected: null, reason: 'made-up' },
    },
    expectedType: 'ble.connection',
    expectedField: 'payload.reason',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.reconnect: attempt 누락',
    msg: {
      ...baseNativeEnv('ble.reconnect'),
      payload: { deviceId: 'dev-1', maxAttempts: 5 },
    },
    expectedType: 'ble.reconnect',
    expectedField: 'payload.attempt',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.notify: key가 알려지지 않은 값',
    msg: {
      ...baseNativeEnv('ble.notify'),
      payload: { subscriptionId: 's1', key: 'bogus', base64Value: 'AAAA' },
    },
    expectedType: 'ble.notify',
    expectedField: 'payload.key',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.notify: touch가 객체지만 type 필드가 잘못됨',
    msg: {
      ...baseNativeEnv('ble.notify'),
      payload: {
        subscriptionId: 's1',
        key: 'notify',
        base64Value: 'AAAA',
        touch: { ...validTouch, type: 'NOT_TOUCH' },
      },
    },
    expectedType: 'ble.notify',
    expectedField: 'payload.touch.type',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.touch: touch 누락',
    msg: { ...baseNativeEnv('ble.touch'), payload: {} },
    expectedType: 'ble.touch',
    expectedField: 'payload.touch',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.touch: deviceDeltaValid가 boolean 아님',
    msg: {
      ...baseNativeEnv('ble.touch'),
      payload: { touch: { ...validTouch, deviceDeltaValid: 1 } },
    },
    expectedType: 'ble.touch',
    expectedField: 'payload.touch.deviceDeltaValid',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.gatt: services가 배열 아님',
    msg: { ...baseNativeEnv('ble.gatt'), payload: { services: 'oops', selected: null } },
    expectedType: 'ble.gatt',
    expectedField: 'payload.services',
    expectedReason: 'field-type',
  },
  {
    label: 'ble.gatt: selected 키 자체가 없음',
    msg: { ...baseNativeEnv('ble.gatt'), payload: { services: [] } },
    expectedType: 'ble.gatt',
    expectedField: 'payload.selected',
    expectedReason: 'field-missing',
  },
  {
    label: 'ble.error: code가 알려지지 않은 값',
    msg: {
      ...baseNativeEnv('ble.error'),
      payload: { code: 'WHO_KNOWS', message: 'x' },
    },
    expectedType: 'ble.error',
    expectedField: 'payload.code',
    expectedReason: 'field-enum',
  },
  {
    label: 'ble.error: action이 알려지지 않은 값',
    msg: {
      ...baseNativeEnv('ble.error'),
      payload: { code: 'WRITE_FAIL', message: 'x', action: 'flop' },
    },
    expectedType: 'ble.error',
    expectedField: 'payload.action',
    expectedReason: 'field-enum',
  },
  {
    label: 'push.state: status가 알려지지 않은 값',
    msg: { ...baseNativeEnv('push.state'), payload: { status: 'maybe' } },
    expectedType: 'push.state',
    expectedField: 'payload.status',
    expectedReason: 'field-enum',
  },
];

describe('isNativeToWebMessage — 정상 payload 진리표', () => {
  for (const c of VALID_NATIVE_TO_WEB) {
    it(`${c.label} → true`, () => {
      expect(isNativeToWebMessage(c.msg)).toBe(true);
      const r = validateNativeToWebMessage(c.msg);
      expect(r.ok).toBe(true);
    });
  }

  it('payload에 추가 필드가 있어도 통과 (forward-compatible)', () => {
    expect(
      isNativeToWebMessage({
        ...baseNativeEnv('ble.connection'),
        payload: { connected: null, reason: 'user', futureField: 'ok' },
      }),
    ).toBe(true);
  });

  it('id 필드가 함께 와도 통과 (envelope 의 id 는 native→web 에선 무시)', () => {
    expect(
      isNativeToWebMessage({
        ...baseNativeEnv('native.ack'),
        id: 'extra',
        payload: { id: 'req-1', ok: true },
      }),
    ).toBe(true);
  });
});

describe('isNativeToWebMessage — 잘못된 payload 진리표', () => {
  for (const c of INVALID_NATIVE_TO_WEB) {
    it(`${c.label} → false`, () => {
      expect(isNativeToWebMessage(c.msg)).toBe(false);
      const r = validateNativeToWebMessage(c.msg);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        if (c.expectedType !== undefined) expect(r.error.type).toBe(c.expectedType);
        if (c.expectedField !== undefined) expect(r.error.field).toBe(c.expectedField);
        if (c.expectedReason !== undefined) expect(r.error.reason).toBe(c.expectedReason);
        expect(typeof r.error.message).toBe('string');
        expect(r.error.message.length).toBeGreaterThan(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 교차 진리표 — 두 가드의 분리
// ---------------------------------------------------------------------------
//
// id가 없는 메시지는 native→web으로만 통과해야 한다. 잘못된 방향으로 dispatch
// 되면 ack 매칭이 깨지거나 송신측이 응답을 기다리며 hang 한다.
// 또한 type 화이트리스트가 분리되어 있으므로, 같은 메시지가 양쪽 모두 통과하지
// 않는 것이 의도된 동작 (Task #30 이후).
//
describe('두 가드의 분리 — 방향성/타입 화이트리스트', () => {
  it('id 없는 native broadcast: native→web만 true', () => {
    const msg = { ...baseNativeEnv('ble.discovery'), payload: { device: validDevice } };
    expect(isNativeToWebMessage(msg)).toBe(true);
    expect(isWebToNativeMessage(msg)).toBe(false);
  });

  it('native.ack 는 native→web 화이트리스트에만 존재 → 양방향 통과 안 함', () => {
    const msg = {
      v: NATIVE_BRIDGE_VERSION,
      type: 'native.ack',
      id: 'req-1',
      payload: { id: 'req-1', ok: true },
    };
    expect(isNativeToWebMessage(msg)).toBe(true);
    expect(isWebToNativeMessage(msg)).toBe(false);
  });

  it('ble.connect 는 web→native 화이트리스트에만 존재 → native→web 으론 false', () => {
    const msg = { ...baseEnv('ble.connect'), payload: { deviceId: 'dev-1' } };
    expect(isWebToNativeMessage(msg)).toBe(true);
    expect(isNativeToWebMessage(msg)).toBe(false);
  });

  it('잘못된 v: 어느 가드도 통과하지 않음', () => {
    const msg = { v: 999, type: 'ble.discovery', id: 'x' };
    expect(isNativeToWebMessage(msg)).toBe(false);
    expect(isWebToNativeMessage(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validate* 결과 — envelope 단계에서도 구조화된 에러를 반환
// ---------------------------------------------------------------------------
//
describe('validate* — envelope 단계 에러도 구조화된 reason 으로 식별 가능', () => {
  it('not-object: null 입력', () => {
    const r = validateWebToNativeMessage(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('not-object');
  });

  it('envelope-version: v=1', () => {
    const r = validateWebToNativeMessage({ v: 1, type: 'ble.ensureReady', id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toBe('envelope-version');
      expect(r.error.field).toBe('v');
    }
  });

  it('envelope-type: type 누락', () => {
    const r = validateNativeToWebMessage({ v: NATIVE_BRIDGE_VERSION });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toBe('envelope-type');
      expect(r.error.field).toBe('type');
    }
  });

  it('envelope-id: web→native 에서 id 누락', () => {
    const r = validateWebToNativeMessage({ v: NATIVE_BRIDGE_VERSION, type: 'ble.ensureReady' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toBe('envelope-id');
      expect(r.error.field).toBe('id');
    }
  });
});

// ---------------------------------------------------------------------------
// formatBridgeValidationError ↔ parseBridgeAckError 라운드트립 (Task #105)
// ---------------------------------------------------------------------------
//
// 모바일 디스패처는 거부 사유를 `formatBridgeValidationError` 로 직렬화해
// `native.ack.payload.error` 에 실어 보내고, 웹 수신기는 `parseBridgeAckError`
// 로 다시 분해한다. 두 함수가 같은 파일에 있어 한쪽만 바꿔도 이 라운드트립이
// 깨지면 즉시 테스트가 실패한다 — 구분자 변경/누락 시 토스트가 조용히 깨지는
// 회귀를 막는다.
//
describe('formatBridgeValidationError ↔ parseBridgeAckError 라운드트립', () => {
  // 검증기가 실제로 만들 수 있는 다양한 모양의 에러 — type/field/reason 조합을
  // 가급적 망라해 한쪽 분기만 깨지는 변경을 잡는다.
  const SAMPLES: BridgeValidationError[] = [
    {
      type: 'ble.connect',
      reason: 'field-missing',
      field: 'payload.deviceId',
      message: 'ble.connect: payload.deviceId is required (string)',
    },
    {
      type: 'ble.writeLed',
      reason: 'field-range',
      field: 'payload.pod',
      message: 'ble.writeLed: payload.pod must be in [0, 3] (got 4)',
    },
    {
      type: 'ble.writeLed',
      reason: 'field-enum',
      field: 'payload.colorCode',
      message: 'ble.writeLed: payload.colorCode must be one of [...]',
    },
    {
      // envelope 검증 실패 — type 미상
      reason: 'envelope-version',
      field: 'v',
      message: `envelope.v must be ${NATIVE_BRIDGE_VERSION} (got 1)`,
    },
    {
      // envelope.id 누락 — type 은 있고 field 만 있음
      type: 'ble.ensureReady',
      reason: 'envelope-id',
      field: 'id',
      message: 'envelope.id must be a string for web→native messages',
    },
    {
      // payload 객체 자체가 누락 — field 가 'payload'
      type: 'ble.connect',
      reason: 'payload-missing',
      field: 'payload',
      message: 'ble.connect: payload is required',
    },
    {
      // unknown-type — field 없음
      type: 'no.such.type',
      reason: 'unknown-type',
      message: 'unknown bridge message type: no.such.type',
    },
  ];

  for (const err of SAMPLES) {
    const label = `${err.type ?? 'envelope'}/${err.reason}${err.field ? '@' + err.field : ''}`;
    it(`${label} 직렬화 → 파싱 시 type/field/reason/message 보존`, () => {
      const raw = formatBridgeValidationError(err);
      const parsed = parseBridgeAckError(raw);
      expect(parsed.reason).toBe(err.reason);
      // type 이 없는 에러는 'envelope' 으로 직렬화됐다가 그대로 파싱된다.
      expect(parsed.type).toBe(err.type ?? 'envelope');
      expect(parsed.field).toBe(err.field);
      expect(parsed.message).toBe(err.message);
    });
  }

  it('모든 BridgeValidationErrorReason 값이 라운드트립한다', () => {
    // KNOWN_REASONS 와 BRIDGE_VALIDATION_ERROR_REASONS 가 어긋나지 않는다는
    // 회귀 보장 — shared 에 reason 을 추가하면 자동으로 이 케이스에 포함된다.
    for (const reason of BRIDGE_VALIDATION_ERROR_REASONS) {
      const err: BridgeValidationError = {
        type: 'sample.type',
        reason,
        field: 'payload.x',
        message: `sample message for ${reason}`,
      };
      const parsed = parseBridgeAckError(formatBridgeValidationError(err));
      expect(parsed.reason).toBe(reason);
      expect(parsed.field).toBe('payload.x');
      expect(parsed.type).toBe('sample.type');
    }
  });

  it('field 가 없는 에러는 prefix 에 @ 가 붙지 않는다', () => {
    const err: BridgeValidationError = {
      type: 'ble.foo',
      reason: 'unknown-type',
      message: 'no field here',
    };
    const raw = formatBridgeValidationError(err);
    expect(raw).toBe('ble.foo:unknown-type: no field here');
    const parsed = parseBridgeAckError(raw);
    expect(parsed.field).toBeUndefined();
  });

  it('type 이 없는 에러는 envelope 로 직렬화된다', () => {
    const err: BridgeValidationError = {
      reason: 'not-object',
      message: 'Bridge message must be a plain object',
    };
    const raw = formatBridgeValidationError(err);
    expect(raw.startsWith('envelope:not-object:')).toBe(true);
    const parsed = parseBridgeAckError(raw);
    expect(parsed.type).toBe('envelope');
    expect(parsed.reason).toBe('not-object');
  });
});

describe('parseBridgeAckError — 자유 문자열 / 짧은 형태 폴백', () => {
  it('알 수 없는 reason 은 자유 문자열로 취급', () => {
    const r = parseBridgeAckError('version-mismatch');
    expect(r.reason).toBeUndefined();
    expect(r.type).toBeUndefined();
    expect(r.field).toBeUndefined();
    expect(r.message).toBe('version-mismatch');
  });

  it('BleManagerError.message 같은 자유 문자열도 원문 보존', () => {
    const raw = 'Device is not connected';
    const r = parseBridgeAckError(raw);
    expect(r.reason).toBeUndefined();
    expect(r.message).toBe(raw);
  });

  it('주변 공백은 trim 한다', () => {
    const r = parseBridgeAckError('   ble.connect:field-missing@payload.deviceId: msg   ');
    expect(r.reason).toBe('field-missing');
    expect(r.field).toBe('payload.deviceId');
    expect(r.message).toBe('msg');
  });

  it('reason 이 알려진 enum 처럼 보이지만 enum 이 아닌 경우 자유 문자열로 폴백', () => {
    // reason 이 enum 집합에 없으면 형식이 prefix 같아도 자유 문자열로 취급해야
    // BleManagerError 메시지(`X: Y` 같은 자연스러운 텍스트)가 망가지지 않는다.
    const r = parseBridgeAckError('SomeError: human readable explanation');
    expect(r.reason).toBeUndefined();
    expect(r.type).toBeUndefined();
    expect(r.message).toBe('SomeError: human readable explanation');
  });
});

describe('BRIDGE_VALIDATION_ERROR_REASONS — 타입과 런타임 enum 일치', () => {
  it('배열에서 derive 한 타입은 배열 원소를 모두 커버한다', () => {
    // 컴파일 시점 잠금 — 배열에서 derive 한 union type 을 사용해 컴파일러가
    // 누락된 reason 을 검출하도록 한다.
    const seen: Record<BridgeValidationErrorReason, true> = {
      'not-object': true,
      'envelope-version': true,
      'envelope-type': true,
      'envelope-id': true,
      'unknown-type': true,
      'payload-missing': true,
      'payload-shape': true,
      'field-missing': true,
      'field-type': true,
      'field-enum': true,
      'field-range': true,
    };
    for (const r of BRIDGE_VALIDATION_ERROR_REASONS) {
      expect(seen[r]).toBe(true);
    }
    expect(BRIDGE_VALIDATION_ERROR_REASONS.length).toBe(Object.keys(seen).length);
  });
});
