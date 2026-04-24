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
} as const;
export type ColorCode = (typeof COLOR_CODE)[keyof typeof COLOR_CODE];

/** 펌웨어 명세 상한. 클라이언트에서 SESSION 길이 검증에 사용 */
export const MAX_SESSION_MS = 300_000;

/** 펌웨어가 보내는 TOUCH 프레임 크기 (bytes) */
export const TOUCH_FRAME_BYTES = 11;

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
