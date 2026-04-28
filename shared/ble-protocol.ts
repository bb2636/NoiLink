/**
 * NoiPod BLE 바이너리 프로토콜 (LED / SESSION / CONTROL / TOUCH)
 *
 * - 모든 프레임의 첫 바이트는 SYNC_BYTE (0xA5)
 * - 정수는 LE (Little Endian)
 * - Buffer 의존 없이 Uint8Array + 자체 base64/hex 유틸로 처리해
 *   React Native / 브라우저 양쪽에서 그대로 사용 가능
 *
 * 펌웨어와 정합성을 맞추는 정본은 이 파일이다. 바이트 레이아웃 변경 시
 * 펌웨어 팀과 동시에 수정해야 한다.
 *
 * LED 즉시 소등 컨벤션(색=0xFF 또는 onMs=0)은 펌웨어 합의서를 참고:
 *   docs/firmware/led-off-convention.md
 */

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

export const SYNC_BYTE = 0xa5;

export const OP_LED = 0x01;
export const OP_SESSION = 0x02;
export const OP_CONTROL = 0x03;
export const OP_TOUCH = 0x81;

export const CTRL_START = 0x00;
export const CTRL_STOP = 0x01;
export const CTRL_PAUSE = 0x02;
export type ControlCmd = typeof CTRL_START | typeof CTRL_STOP | typeof CTRL_PAUSE;

export const SESSION_PHASE_RHYTHM = 0;
export const SESSION_PHASE_COGNITIVE = 1;
export type SessionPhase = typeof SESSION_PHASE_RHYTHM | typeof SESSION_PHASE_COGNITIVE;

export const CHANNEL_HAND = 0;
export const CHANNEL_FOOT = 1;
export type ChannelCode = typeof CHANNEL_HAND | typeof CHANNEL_FOOT;

export const COLOR_CODE = {
  GREEN: 0,
  RED: 1,
  BLUE: 2,
  YELLOW: 3,
  WHITE: 4,
  MIXED: 5,
  /**
   * 즉시 소등용 색 코드. 사용자가 점등 onMs 만료 전에 탭하거나 엔진이
   * `allOff()`를 호출했을 때 디바이스 LED도 함께 끄기 위해 사용한다.
   * 펌웨어는 OFF 색을 받으면 onMs와 무관하게 즉시 LED를 끈다.
   * onMs=0 컨벤션도 동일한 의미로 해석한다(둘 다 OFF로 간주).
   */
  OFF: 0xff,
} as const;
export type ColorCode = (typeof COLOR_CODE)[keyof typeof COLOR_CODE];

/** 펌웨어 명세 상한. 클라이언트에서 SESSION 길이 검증에 사용 */
export const MAX_SESSION_MS = 300_000;

/**
 * 초 단위 SESSION 길이 상한 (`MAX_SESSION_MS / 1000 = 300`).
 * SESSION Write 의 `durationSec` 필드는 펌웨어 u16 이지만 사용자 트레이닝
 * 길이는 5분(300s)로 제한된다. 브리지 가드가 이 값을 초과한 페이로드를 거부.
 */
export const MAX_SESSION_SEC = MAX_SESSION_MS / 1000;

/**
 * LED Write `pod` 인덱스 범위 (펌웨어 u8 이지만 NoiPod 본체에 4 pod 만 존재).
 * 0..3 외의 값은 펌웨어가 byte 로 misinterpret 하기 전에 브리지에서 거부한다.
 */
export const POD_INDEX_MIN = 0;
export const POD_INDEX_MAX = 3;

/**
 * SESSION Write `level` 범위 (트레이닝 사양: 1..5). 0 이나 6+ 은 브리지가 거부.
 */
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 5;

/**
 * SESSION Write `bpm` 범위. 트레이닝 spec(`shared/training-spec.ts`)의
 * BPM clamp 와 동일한 60..200. 펌웨어 u16 으로 직렬화되지만 그 전에 브리지가
 * 사용자/엔진의 잘못된 BPM 을 거부한다.
 */
export const BPM_MIN = 60;
export const BPM_MAX = 200;

/** 펌웨어가 보내는 TOUCH 프레임 크기 (bytes) */
export const TOUCH_FRAME_BYTES = 11;

/**
 * 펌웨어 LE 정수 폭 상한. 브리지 가드가 `tickId` (u32 LE), `onMs` (u16 LE),
 * `flags` (u8) 같은 필드를 펌웨어 byte 로 silently truncate 되기 전에
 * 거부하기 위해 사용한다 — 음수/소수/상한 초과는 `writeU16LE`/`writeU32LE`
 * 가 비트마스킹으로 잘라내 다른 tick / 0ms / 다른 비트 set 으로 오인된다.
 */
export const U8_MAX = 0xff;
export const U16_MAX = 0xffff;
export const U32_MAX = 0xffffffff;

// ---------------------------------------------------------------------------
// hex / base64 / Uint8Array 변환 (Buffer 없이)
// ---------------------------------------------------------------------------

const HEX_CHARS = '0123456789abcdef';
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    s += HEX_CHARS[(b >> 4) & 0x0f];
    s += HEX_CHARS[b & 0x0f];
  }
  return s;
}

export function isValidHexEven(hex: string): boolean {
  if (typeof hex !== 'string') return false;
  if (hex.length === 0) return false;
  if (hex.length % 2 !== 0) return false;
  return /^[0-9a-fA-F]+$/.test(hex);
}

/** 공백·`0x` 접두 제거 후 짝수 길이 hex만 허용. 검증 실패시 null */
export function normalizeHex(hex: string): string | null {
  const cleaned = hex.replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
  return isValidHexEven(cleaned) ? cleaned : null;
}

export function hexToBytes(hex: string): Uint8Array {
  const norm = normalizeHex(hex);
  if (!norm) throw new Error('Invalid hex string');
  const out = new Uint8Array(norm.length / 2);
  for (let i = 0; i < norm.length; i += 2) {
    out[i / 2] = parseInt(norm.slice(i, i + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  const n = bytes.length;
  for (; i + 2 < n; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    const c = bytes[i + 2]!;
    s += B64_CHARS[a >> 2];
    s += B64_CHARS[((a & 0x03) << 4) | (b >> 4)];
    s += B64_CHARS[((b & 0x0f) << 2) | (c >> 6)];
    s += B64_CHARS[c & 0x3f];
  }
  if (i < n) {
    const a = bytes[i]!;
    s += B64_CHARS[a >> 2];
    if (i + 1 < n) {
      const b = bytes[i + 1]!;
      s += B64_CHARS[((a & 0x03) << 4) | (b >> 4)];
      s += B64_CHARS[(b & 0x0f) << 2];
      s += '=';
    } else {
      s += B64_CHARS[(a & 0x03) << 4];
      s += '==';
    }
  }
  return s;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_CHARS.indexOf(clean[i]!);
    const b = B64_CHARS.indexOf(clean[i + 1]!);
    const c = i + 2 < clean.length ? B64_CHARS.indexOf(clean[i + 2]!) : -1;
    const d = i + 3 < clean.length ? B64_CHARS.indexOf(clean[i + 3]!) : -1;
    if (a < 0 || b < 0) break;
    out[p++] = (a << 2) | (b >> 4);
    if (c >= 0) out[p++] = ((b & 0x0f) << 4) | (c >> 2);
    if (d >= 0) out[p++] = ((c & 0x03) << 6) | d;
  }
  return out.subarray(0, p);
}

export function hexToBase64(hex: string): string {
  return bytesToBase64(hexToBytes(hex));
}

export function base64ToHex(b64: string): string {
  return bytesToHex(base64ToBytes(b64));
}

// ---------------------------------------------------------------------------
// 인코더 — Write 프레임 (앱 → 기기)
// ---------------------------------------------------------------------------

function writeU16LE(buf: Uint8Array, off: number, v: number): void {
  const u = v & 0xffff;
  buf[off] = u & 0xff;
  buf[off + 1] = (u >> 8) & 0xff;
}

function writeI16LE(buf: Uint8Array, off: number, v: number): void {
  // signed int16 → 2's complement 표현
  const s = ((v | 0) << 16) >> 16;
  const u = s & 0xffff;
  buf[off] = u & 0xff;
  buf[off + 1] = (u >> 8) & 0xff;
}

function writeU32LE(buf: Uint8Array, off: number, v: number): void {
  // u32 안전 처리 (bitwise는 32bit signed로 동작하므로 분리)
  const u = v >>> 0;
  buf[off] = u & 0xff;
  buf[off + 1] = (u >> 8) & 0xff;
  buf[off + 2] = (u >> 16) & 0xff;
  buf[off + 3] = (u >>> 24) & 0xff;
}

function readU16LE(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

function readI16LE(buf: Uint8Array, off: number): number {
  const u = readU16LE(buf, off);
  return (u << 16) >> 16; // sign-extend
}

function readU32LE(buf: Uint8Array, off: number): number {
  return (
    (buf[off]! |
      (buf[off + 1]! << 8) |
      (buf[off + 2]! << 16) |
      (buf[off + 3]! << 24)) >>>
    0
  );
}

export interface LedFrameOpts {
  tickId: number;
  pod: number;        // 0..3
  colorCode: ColorCode;
  onMs: number;       // u16
  flags?: number;     // u8 (default 0)
}

/** 12바이트 LED Write 프레임 */
export function encodeLedFrame(opts: LedFrameOpts): Uint8Array {
  const buf = new Uint8Array(12);
  buf[0] = SYNC_BYTE;
  buf[1] = OP_LED;
  writeU32LE(buf, 2, opts.tickId);
  buf[6] = opts.pod & 0xff;
  buf[7] = opts.colorCode & 0xff;
  writeU16LE(buf, 8, opts.onMs);
  buf[10] = (opts.flags ?? 0) & 0xff;
  buf[11] = 0;
  return buf;
}

/**
 * 단일 Pod 즉시 소등용 LED 프레임 빌더.
 *
 * 펌웨어와의 약속 (정본: docs/firmware/led-off-convention.md):
 *  - colorCode = `COLOR_CODE.OFF (0xFF)`
 *  - onMs = 0
 *  - 둘 중 하나만 충족해도 OFF로 해석한다(이중 안전장치).
 *
 * 사용자가 점등 onMs 안에 탭하거나 엔진이 `allOff()`를 호출할 때 호출해
 * 화면 UI와 디바이스 LED의 종료 시점을 일치시키는 데 사용한다.
 */
export function encodeLedOffFrame(opts: { tickId: number; pod: number }): Uint8Array {
  return encodeLedFrame({
    tickId: opts.tickId,
    pod: opts.pod,
    colorCode: COLOR_CODE.OFF,
    onMs: 0,
  });
}

/**
 * LED 프레임이 OFF 컨벤션(색=OFF 또는 onMs=0)을 만족하는지 검사.
 * 정본: docs/firmware/led-off-convention.md
 */
export function isLedOffPayload(opts: { colorCode: number; onMs: number }): boolean {
  return opts.colorCode === COLOR_CODE.OFF || opts.onMs === 0;
}

export interface SessionFrameOpts {
  bpm: number;        // u16
  level: number;      // u8 (1..5)
  phase: SessionPhase;
  durationSec: number; // u16
  flags?: number;
}

/** 14바이트 SESSION Write 프레임 (트레이닝 시작 시) */
export function encodeSessionFrame(opts: SessionFrameOpts): Uint8Array {
  const buf = new Uint8Array(14);
  buf[0] = SYNC_BYTE;
  buf[1] = OP_SESSION;
  writeU16LE(buf, 2, opts.bpm);
  buf[4] = opts.level & 0xff;
  buf[5] = opts.phase & 0xff;
  writeU16LE(buf, 6, opts.durationSec);
  buf[8] = (opts.flags ?? 0) & 0xff;
  // 9..13 padding (이미 0)
  return buf;
}

/** 6바이트 CONTROL Write 프레임 (START / STOP / PAUSE) */
export function encodeControlFrame(cmd: ControlCmd): Uint8Array {
  const buf = new Uint8Array(6);
  buf[0] = SYNC_BYTE;
  buf[1] = OP_CONTROL;
  buf[2] = cmd & 0xff;
  // 3..5 padding (이미 0)
  return buf;
}

// ---------------------------------------------------------------------------
// 디코더 — Notify (기기 → 앱)
// ---------------------------------------------------------------------------

export interface TouchEvent {
  type: 'TOUCH';
  tickId: number;
  pod: number;
  channel: number;
  /** 펌웨어가 측정한 오차 ms (signed). deviceDeltaValid=true 일 때만 실측치 */
  deltaMs: number;
  deviceDeltaValid: boolean;
}

/** TOUCH Notify (11바이트) 파싱. 헤더 불일치/길이 부족이면 null */
export function tryParseTouchBytes(bytes: Uint8Array): TouchEvent | null {
  if (bytes.length < TOUCH_FRAME_BYTES) return null;
  if (bytes[0] !== SYNC_BYTE) return null;
  if (bytes[1] !== OP_TOUCH) return null;
  const tickId = readU32LE(bytes, 2);
  const pod = bytes[6]!;
  const channel = bytes[7]!;
  const deltaMs = readI16LE(bytes, 8);
  const flags = bytes[10]!;
  return {
    type: 'TOUCH',
    tickId,
    pod,
    channel,
    deltaMs,
    deviceDeltaValid: (flags & 0x01) === 0x01,
  };
}

export function tryParseTouchHex(hex: string): TouchEvent | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  if (norm.length < TOUCH_FRAME_BYTES * 2) return null;
  try {
    return tryParseTouchBytes(hexToBytes(norm));
  } catch {
    return null;
  }
}

export function tryParseTouchBase64(b64: string): TouchEvent | null {
  try {
    return tryParseTouchBytes(base64ToBytes(b64));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 리듬 판정 (Notify TOUCH의 errMs → grade/score)
// ---------------------------------------------------------------------------

// RhythmGrade는 types.ts에서 이미 정의됨 — 동일 정의를 재사용
import type { RhythmGrade } from './types.js';
export type { RhythmGrade } from './types.js';

export const RHYTHM_THRESHOLDS_MS = {
  PERFECT: 45,
  GOOD: 110,
  BAD: 200,
} as const;

export const RHYTHM_GRADE_SCORE: Record<RhythmGrade, number> = {
  PERFECT: 100,
  GOOD: 70,
  BAD: 35,
  MISS: 0,
};

/** errMs는 (실제 입력 시각 - 목표 시각). 부호 무관, |errMs| 기준 등급 */
export function judgeRhythmError(errMs: number): RhythmGrade {
  const a = Math.abs(errMs);
  if (a <= RHYTHM_THRESHOLDS_MS.PERFECT) return 'PERFECT';
  if (a <= RHYTHM_THRESHOLDS_MS.GOOD) return 'GOOD';
  if (a <= RHYTHM_THRESHOLDS_MS.BAD) return 'BAD';
  return 'MISS';
}

export interface RhythmCounts {
  perfect: number;
  good: number;
  bad: number;
  miss: number;
}

/** 종합 점수 0..100 (모두 0이면 0 반환) */
export function rhythmScoreFromCounts(c: RhythmCounts): number {
  const n = c.perfect + c.good + c.bad + c.miss;
  if (n <= 0) return 0;
  const sum =
    c.perfect * RHYTHM_GRADE_SCORE.PERFECT +
    c.good * RHYTHM_GRADE_SCORE.GOOD +
    c.bad * RHYTHM_GRADE_SCORE.BAD +
    c.miss * RHYTHM_GRADE_SCORE.MISS;
  return Math.round((sum / (n * 100)) * 100);
}

// ---------------------------------------------------------------------------
// 트레이닝 보조 공식 (점등 길이 / 혼합색 비율)
// ---------------------------------------------------------------------------

/** 명세 12.6: clamp(380 - level*45, 120, 420) */
export function onMsForLevel(level: number): number {
  const v = 380 - level * 45;
  return Math.max(120, Math.min(420, v));
}

/** 명세 12.6: Lv≤1 → 0, Lv≥5 → 0.35, 사이 선형 보간 */
export function mixedColorRate(level: number): number {
  if (level <= 1) return 0;
  if (level >= 5) return 0.35;
  return ((level - 1) / 4) * 0.35;
}

// ---------------------------------------------------------------------------
// 레거시 모드 인코더 (NoiPod 정식 펌웨어 미탑재 모듈용)
//
// NINA-B1 디폴트 펌웨어 또는 그 위에 얹힌 단순 LED 컨트롤러 펌웨어가
// 12바이트 NoiPod 프레임을 모르는 경우 사용한다. 참조: savexx 스펙
// (`attached_assets/BLE_SAVEXX_FULL_SPEC_*.md`) §11 / §12.5
//
//   - LED 점등 :  `4e <pod+1 1바이트> 0d` (3바이트, "N" + idx + CR)
//   - START    :  `aa 55`
//   - STOP     :  `ff`
//
// 색상 / onMs 는 레거시 펌웨어가 자체적으로 처리(또는 무시)하므로 페이로드에
// 싣지 않는다. SESSION 메타(BPM/level/durationSec)도 레거시 펌웨어가
// 모르므로 호출부에서 송신 자체를 생략한다.
// ---------------------------------------------------------------------------

/**
 * 레거시 LED 점등 프레임. pod 0..7 만 허용(spec §11 COLOR 1..8 슬롯).
 * 우리 앱은 pod 0..3 만 사용하지만 향후 확장에 대비해 0..7 허용.
 */
export function encodeLegacyLedFrame(opts: { pod: number }): Uint8Array {
  const pod = opts.pod | 0;
  if (pod < 0 || pod > 7) {
    throw new RangeError(`encodeLegacyLedFrame: pod out of range (0..7): ${pod}`);
  }
  return new Uint8Array([0x4e, pod + 1, 0x0d]);
}

/** 레거시 START 프레임 `aa 55`. */
export function encodeLegacyControlStartFrame(): Uint8Array {
  return new Uint8Array([0xaa, 0x55]);
}

/** 레거시 STOP 프레임 `ff`. */
export function encodeLegacyControlStopFrame(): Uint8Array {
  return new Uint8Array([0xff]);
}

// ---------------------------------------------------------------------------
// 레거시 모드 디코더 — Notify (기기 → 앱)
//
// 현행 펌웨어가 200ms 마다 보내는 5바이트 IR/터치 패킷, 그리고 NFC 리더가
// 태그를 읽었을 때 토해내는 NFC NDEF Text Record 를 파싱한다.
//
// IR 패킷 (5바이트, big-endian):
//   [0] IR 거리 상위 8비트
//   [1] IR 거리 하위 8비트   → distanceMm = (b0 << 8) | b1   (예: 0x069C = 1692)
//   [2] 터치 카운트 (펌웨어 누적, u8 wrap)
//   [3] 0x0D
//   [4] 0x0A
//
// NFC NDEF Text Record (RFC 3986/NFC Forum NDEF Text RTD):
//   [0]    0xD1   (NDEF header: MB=1 ME=1 SR=1 TNF=001)
//   [1]    0x01   (type length = 1)
//   [2]    PAYLOAD_LEN
//   [3]    0x54   ('T' = Text RTD)
//   [4]    STATUS (bit7=enc UTF-16, bits0..5=lang code length L)
//   [5..]  lang code L bytes (예: 'en' = 0x65 0x6E)
//   [..]   text bytes (PAYLOAD_LEN - 1 - L)
//   [..]   선택적 종료자 0x0A
// ---------------------------------------------------------------------------

export const LEGACY_IR_FRAME_BYTES = 5;
export const LEGACY_IR_TERMINATOR_0 = 0x0d;
export const LEGACY_IR_TERMINATOR_1 = 0x0a;

export interface LegacyIrEvent {
  type: 'IR';
  /** IR 센서 거리 (mm). big-endian 16-bit. */
  distanceMm: number;
  /** 펌웨어가 누적해서 보내는 터치 카운트 (u8, wrap-around). */
  touchCount: number;
}

/** 5바이트 IR 패킷 파싱. 종료자(0x0D 0x0A) 불일치/길이 부족이면 null */
export function tryParseLegacyIrBytes(bytes: Uint8Array): LegacyIrEvent | null {
  if (bytes.length < LEGACY_IR_FRAME_BYTES) return null;
  if (bytes[3] !== LEGACY_IR_TERMINATOR_0) return null;
  if (bytes[4] !== LEGACY_IR_TERMINATOR_1) return null;
  const distanceMm = ((bytes[0]! << 8) | bytes[1]!) & 0xffff;
  const touchCount = bytes[2]!;
  return { type: 'IR', distanceMm, touchCount };
}

export function tryParseLegacyIrBase64(b64: string): LegacyIrEvent | null {
  try {
    return tryParseLegacyIrBytes(base64ToBytes(b64));
  } catch {
    return null;
  }
}

export interface LegacyNdefTextEvent {
  type: 'NFC_TEXT';
  /** 디코딩된 텍스트 페이로드 (예: "left", "right", "1", "2"). */
  text: string;
  /** ISO 639-1 언어 코드 (예: "en", "ko"). 비어있을 수 있음. */
  language: string;
}

/**
 * NFC NDEF Text Record(시작 0xD1 0x01) 파싱. ASCII/UTF-8 만 디코드.
 * 헤더 불일치/payload 길이 모자람 / UTF-16 인코딩 / 잘못된 status 면 null.
 */
export function tryParseLegacyNdefTextBytes(bytes: Uint8Array): LegacyNdefTextEvent | null {
  if (bytes.length < 5) return null;
  if (bytes[0] !== 0xd1) return null;
  const typeLen = bytes[1]!;
  if (typeLen !== 0x01) return null;
  const payloadLen = bytes[2]!;
  if (bytes[3] !== 0x54) return null; // 'T' = Text RTD
  const status = bytes[4]!;
  // 우리가 지원하는 건 UTF-8 만 (high bit 0).
  if ((status & 0x80) !== 0) return null;
  const langLen = status & 0x3f;
  // 4(header) + 1(status) + langLen + textLen = 4 + payloadLen 가 되어야 함.
  // 즉 textLen = payloadLen - 1 - langLen.
  const textLen = payloadLen - 1 - langLen;
  if (textLen < 0) return null;
  if (bytes.length < 5 + langLen + textLen) return null;
  let language = '';
  for (let i = 0; i < langLen; i++) {
    const c = bytes[5 + i]!;
    if (c < 0x20 || c > 0x7e) return null; // ASCII printable 만
    language += String.fromCharCode(c);
  }
  let text = '';
  for (let i = 0; i < textLen; i++) {
    const c = bytes[5 + langLen + i]!;
    // UTF-8 1바이트 ASCII 범위만 처리. 2+ 바이트 멀티바이트는 그대로 코드포인트로
    // 옮기지 않고 ASCII 가 아닌 경우 일단 그대로 String.fromCharCode 로 노출.
    text += String.fromCharCode(c);
  }
  // 종료 0x0A 가 텍스트 마지막에 들어와있으면 제거 (펌웨어 컨벤션).
  if (text.endsWith('\n')) text = text.slice(0, -1);
  return { type: 'NFC_TEXT', text, language };
}

export function tryParseLegacyNdefTextBase64(b64: string): LegacyNdefTextEvent | null {
  try {
    return tryParseLegacyNdefTextBytes(base64ToBytes(b64));
  } catch {
    return null;
  }
}

/**
 * 현행 펌웨어가 보낸 notify 페이로드를 한 번에 분류한다.
 * 시도 순서: TOUCH(0xa5/0x81) → IR(5B + 0x0D 0x0A) → NDEF Text(0xD1 0x01 …).
 * 어떤 패턴에도 안 맞으면 null.
 */
export type LegacyNotifyEvent = TouchEvent | LegacyIrEvent | LegacyNdefTextEvent;

export function tryParseAnyNotifyBytes(bytes: Uint8Array): LegacyNotifyEvent | null {
  return (
    tryParseTouchBytes(bytes) ??
    tryParseLegacyIrBytes(bytes) ??
    tryParseLegacyNdefTextBytes(bytes)
  );
}

export function tryParseAnyNotifyBase64(b64: string): LegacyNotifyEvent | null {
  try {
    return tryParseAnyNotifyBytes(base64ToBytes(b64));
  } catch {
    return null;
  }
}
