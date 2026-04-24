import { describe, it, expect } from 'vitest';
import {
  SYNC_BYTE,
  OP_LED,
  OP_SESSION,
  OP_CONTROL,
  OP_TOUCH,
  CTRL_START,
  CTRL_STOP,
  CTRL_PAUSE,
  COLOR_CODE,
  SESSION_PHASE_RHYTHM,
  SESSION_PHASE_COGNITIVE,
  TOUCH_FRAME_BYTES,
  encodeLedFrame,
  encodeLedOffFrame,
  encodeSessionFrame,
  encodeControlFrame,
  isLedOffPayload,
  tryParseTouchBytes,
  tryParseTouchHex,
  tryParseTouchBase64,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
} from './ble-protocol.js';

function hex(...byteSeq: number[]): Uint8Array {
  return new Uint8Array(byteSeq);
}

function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(bytesToHex(actual)).toBe(bytesToHex(expected));
  expect(actual.length).toBe(expected.length);
}

describe('encodeLedFrame', () => {
  it('produces a 12-byte frame with the documented layout', () => {
    const frame = encodeLedFrame({
      tickId: 0x12345678,
      pod: 2,
      colorCode: COLOR_CODE.GREEN,
      onMs: 300,
      flags: 0,
    });
    // SYNC, OP_LED, tickId LE (78 56 34 12), pod, color, onMs LE (2C 01), flags, reserved
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x78, 0x56, 0x34, 0x12, 0x02, 0x00, 0x2c, 0x01, 0x00, 0x00),
    );
    expect(frame[0]).toBe(SYNC_BYTE);
    expect(frame[1]).toBe(OP_LED);
  });

  it('encodes flags into byte 10 and keeps reserved byte 11 zero', () => {
    const frame = encodeLedFrame({
      tickId: 1,
      pod: 0,
      colorCode: COLOR_CODE.RED,
      onMs: 0,
      flags: 0xab,
    });
    expect(frame[10]).toBe(0xab);
    expect(frame[11]).toBe(0x00);
  });

  it('writes tickId as little-endian u32', () => {
    const frame = encodeLedFrame({
      tickId: 0xdeadbeef,
      pod: 0,
      colorCode: COLOR_CODE.GREEN,
      onMs: 0,
    });
    expect(Array.from(frame.slice(2, 6))).toEqual([0xef, 0xbe, 0xad, 0xde]);
  });

  it('writes onMs as little-endian u16', () => {
    const frame = encodeLedFrame({
      tickId: 0,
      pod: 0,
      colorCode: COLOR_CODE.GREEN,
      onMs: 0x1234,
    });
    expect(Array.from(frame.slice(8, 10))).toEqual([0x34, 0x12]);
  });
});

describe('encodeLedOffFrame — OFF 합의서 테스트 벡터', () => {
  // 정본: docs/firmware/led-off-convention.md §3.1
  it('vector 1: pod=0, tickId=0, color=OFF, onMs=0', () => {
    const frame = encodeLedOffFrame({ tickId: 0, pod: 0 });
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00),
    );
  });

  it('vector 2: pod=2, tickId=0x12345678, color=OFF, onMs=0', () => {
    const frame = encodeLedOffFrame({ tickId: 0x12345678, pod: 2 });
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x78, 0x56, 0x34, 0x12, 0x02, 0xff, 0x00, 0x00, 0x00, 0x00),
    );
  });

  it('vector 3: pod=1, tickId=0x42, color=GREEN, onMs=0 (onMs=0 단독 OFF)', () => {
    // 합의서의 세 번째 벡터는 encodeLedFrame으로 직접 만든 GREEN+onMs=0 페이로드.
    const frame = encodeLedFrame({
      tickId: 0x42,
      pod: 1,
      colorCode: COLOR_CODE.GREEN,
      onMs: 0,
    });
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x42, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00),
    );
  });

  it('encodeLedOffFrame는 항상 colorCode=0xFF, onMs=0', () => {
    for (let pod = 0; pod < 4; pod++) {
      const frame = encodeLedOffFrame({ tickId: 0xcafebabe, pod });
      expect(frame[7]).toBe(0xff);
      expect(frame[8]).toBe(0x00);
      expect(frame[9]).toBe(0x00);
      expect(frame[6]).toBe(pod);
    }
  });
});

describe('isLedOffPayload — OFF 컨벤션 진리표', () => {
  // OR 관계: colorCode==OFF 또는 onMs==0 이면 OFF
  it('OFF / 0 → true', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.OFF, onMs: 0 })).toBe(true);
  });
  it('OFF / 300 → true (color 단독 OFF)', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.OFF, onMs: 300 })).toBe(true);
  });
  it('GREEN / 0 → true (onMs 단독 OFF)', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.GREEN, onMs: 0 })).toBe(true);
  });
  it('GREEN / 300 → false (정상 점등)', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.GREEN, onMs: 300 })).toBe(false);
  });
});

describe('encodeSessionFrame', () => {
  it('produces a 14-byte frame with the documented layout', () => {
    const frame = encodeSessionFrame({
      bpm: 80,
      level: 3,
      phase: SESSION_PHASE_RHYTHM,
      durationSec: 120,
      flags: 0,
    });
    // SYNC, OP_SESSION, bpm LE (50 00), level, phase, durSec LE (78 00), flags, 5 padding
    expectBytes(
      frame,
      hex(0xa5, 0x02, 0x50, 0x00, 0x03, 0x00, 0x78, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00),
    );
    expect(frame.length).toBe(14);
    expect(frame[0]).toBe(SYNC_BYTE);
    expect(frame[1]).toBe(OP_SESSION);
  });

  it('encodes COGNITIVE phase and flags', () => {
    const frame = encodeSessionFrame({
      bpm: 0xabcd,
      level: 5,
      phase: SESSION_PHASE_COGNITIVE,
      durationSec: 0x0102,
      flags: 0x7f,
    });
    expect(Array.from(frame.slice(2, 4))).toEqual([0xcd, 0xab]); // bpm LE
    expect(frame[4]).toBe(0x05); // level
    expect(frame[5]).toBe(0x01); // phase = COGNITIVE
    expect(Array.from(frame.slice(6, 8))).toEqual([0x02, 0x01]); // durSec LE
    expect(frame[8]).toBe(0x7f); // flags
    // padding 9..13 must remain zero
    for (let i = 9; i < 14; i++) expect(frame[i]).toBe(0x00);
  });

  it('omitting flags defaults to 0', () => {
    const frame = encodeSessionFrame({
      bpm: 60,
      level: 1,
      phase: SESSION_PHASE_RHYTHM,
      durationSec: 60,
    });
    expect(frame[8]).toBe(0x00);
  });
});

describe('encodeControlFrame', () => {
  it('START → 6바이트 [A5 03 00 00 00 00]', () => {
    expectBytes(
      encodeControlFrame(CTRL_START),
      hex(0xa5, 0x03, 0x00, 0x00, 0x00, 0x00),
    );
  });
  it('STOP → [A5 03 01 00 00 00]', () => {
    expectBytes(
      encodeControlFrame(CTRL_STOP),
      hex(0xa5, 0x03, 0x01, 0x00, 0x00, 0x00),
    );
  });
  it('PAUSE → [A5 03 02 00 00 00]', () => {
    expectBytes(
      encodeControlFrame(CTRL_PAUSE),
      hex(0xa5, 0x03, 0x02, 0x00, 0x00, 0x00),
    );
  });
  it('frame[0]=SYNC, frame[1]=OP_CONTROL', () => {
    const f = encodeControlFrame(CTRL_START);
    expect(f.length).toBe(6);
    expect(f[0]).toBe(SYNC_BYTE);
    expect(f[1]).toBe(OP_CONTROL);
  });
});

describe('tryParseTouchBytes', () => {
  it('parses a well-formed TOUCH frame (deviceDeltaValid=true)', () => {
    // SYNC, OP_TOUCH, tickId=0x01020304, pod=2, channel=1, deltaMs=+50 (0x0032), flags=0x01
    const bytes = hex(0xa5, 0x81, 0x04, 0x03, 0x02, 0x01, 0x02, 0x01, 0x32, 0x00, 0x01);
    const ev = tryParseTouchBytes(bytes);
    expect(ev).not.toBeNull();
    expect(ev).toEqual({
      type: 'TOUCH',
      tickId: 0x01020304,
      pod: 2,
      channel: 1,
      deltaMs: 50,
      deviceDeltaValid: true,
    });
  });

  it('parses negative deltaMs as signed int16', () => {
    // deltaMs = -100 → 0xFF9C LE → 0x9C 0xFF
    const bytes = hex(0xa5, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9c, 0xff, 0x00);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.deltaMs).toBe(-100);
    expect(ev?.deviceDeltaValid).toBe(false);
  });

  it('flag bit0=0 → deviceDeltaValid=false', () => {
    const bytes = hex(0xa5, 0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0xfe);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.deviceDeltaValid).toBe(false);
  });

  it('flag bit0=1 (with other bits set) → deviceDeltaValid=true', () => {
    const bytes = hex(0xa5, 0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0xff);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.deviceDeltaValid).toBe(true);
  });

  it('returns null when length < TOUCH_FRAME_BYTES', () => {
    const bytes = new Uint8Array(TOUCH_FRAME_BYTES - 1);
    bytes[0] = SYNC_BYTE;
    bytes[1] = OP_TOUCH;
    expect(tryParseTouchBytes(bytes)).toBeNull();
  });

  it('returns null when SYNC byte is wrong', () => {
    const bytes = hex(0x5a, 0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(tryParseTouchBytes(bytes)).toBeNull();
  });

  it('returns null when OP byte is not OP_TOUCH', () => {
    const bytes = hex(0xa5, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(tryParseTouchBytes(bytes)).toBeNull();
  });

  it('reads tickId as little-endian u32', () => {
    const bytes = hex(0xa5, 0x81, 0xef, 0xbe, 0xad, 0xde, 0, 0, 0, 0, 0);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.tickId).toBe(0xdeadbeef);
  });
});

describe('tryParseTouchHex / tryParseTouchBase64', () => {
  // 동일 페이로드를 hex / base64 양쪽으로 디코드 → 결과 동일해야 함
  const bytes = hex(0xa5, 0x81, 0x04, 0x03, 0x02, 0x01, 0x02, 0x01, 0x32, 0x00, 0x01);
  const expected = {
    type: 'TOUCH',
    tickId: 0x01020304,
    pod: 2,
    channel: 1,
    deltaMs: 50,
    deviceDeltaValid: true,
  };

  it('hex (소문자)', () => {
    expect(tryParseTouchHex(bytesToHex(bytes))).toEqual(expected);
  });

  it('hex (대문자 + 0x 접두 + 공백 허용)', () => {
    expect(tryParseTouchHex('0x A5 81 04 03 02 01 02 01 32 00 01')).toEqual(expected);
  });

  it('base64', () => {
    expect(tryParseTouchBase64(bytesToBase64(bytes))).toEqual(expected);
  });

  it('hex 입력이 너무 짧으면 null', () => {
    expect(tryParseTouchHex('a581')).toBeNull();
  });

  it('hex 입력이 잘못된 문자열이면 null', () => {
    expect(tryParseTouchHex('not-hex!!')).toBeNull();
  });
});

describe('round-trip — encode → bytes layout sanity', () => {
  it('LED frame 길이=12, SESSION 길이=14, CONTROL 길이=6', () => {
    expect(
      encodeLedFrame({ tickId: 0, pod: 0, colorCode: COLOR_CODE.GREEN, onMs: 0 }).length,
    ).toBe(12);
    expect(
      encodeSessionFrame({ bpm: 0, level: 1, phase: SESSION_PHASE_RHYTHM, durationSec: 0 })
        .length,
    ).toBe(14);
    expect(encodeControlFrame(CTRL_START).length).toBe(6);
  });

  it('hexToBytes/bytesToHex 가 OFF 벡터 1 을 정확히 왕복한다', () => {
    const expected = 'a50100000000 00ff00000000'.replace(/\s+/g, '');
    const frame = encodeLedOffFrame({ tickId: 0, pod: 0 });
    expect(bytesToHex(frame)).toBe(expected);
    expect(Array.from(hexToBytes(expected))).toEqual(Array.from(frame));
  });
});
