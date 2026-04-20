/**
 * 비밀번호 재설정 OTP 발급/검증
 *
 * - 6자리 숫자 OTP, TTL 5분
 * - KV에 해시(sha256)만 저장 — 평문 저장 금지
 * - attempts 카운터로 brute-force 차단 (5회 초과 시 즉시 차단)
 * - 신규 발급 시 같은 phone의 기존 OTP는 무효화
 */
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { db } from '../db.js';
import { withKeyLock } from './key-mutex.js';

const LOCK_PREFIX = 'lock:otp:';

const OTP_KEY = 'password_reset_otps';
const OTP_TTL_MS = 5 * 60 * 1000; // 5분
const MAX_ATTEMPTS = 5;

export interface OtpRecord {
  phone: string;
  otpHash: string;
  expiresAt: number; // epoch ms
  attempts: number;
  createdAt: number;
}

function hashOtp(phone: string, otp: string): string {
  // phone을 salt로 사용 — 같은 OTP라도 phone마다 다른 hash
  return createHash('sha256').update(`${phone}:${otp}`).digest('hex');
}

function generateOtp(): string {
  // 100000~999999 (6자리, 앞자리 0 방지)
  return String(randomInt(100000, 1000000));
}

async function loadAll(): Promise<OtpRecord[]> {
  const list = await db.get(OTP_KEY) || [];
  // 만료된 항목 자동 청소
  const now = Date.now();
  return (list as OtpRecord[]).filter((r) => r.expiresAt > now);
}

async function saveAll(list: OtpRecord[]): Promise<void> {
  await db.set(OTP_KEY, list);
}

/**
 * OTP 발급. 같은 phone의 기존 OTP는 무효화됨.
 * @returns 평문 OTP (호출자가 SMS로 발송 책임)
 */
export async function issueOtp(phone: string): Promise<string> {
  return withKeyLock(`${LOCK_PREFIX}${phone}`, async () => {
    const otp = generateOtp();
    const otpHash = hashOtp(phone, otp);
    const now = Date.now();

    const all = await loadAll();
    const filtered = all.filter((r) => r.phone !== phone);
    filtered.push({
      phone,
      otpHash,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      createdAt: now,
    });
    await saveAll(filtered);

    return otp;
  });
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'expired' | 'mismatch' | 'too_many_attempts' };

/**
 * OTP 검증. 성공 시 해당 OTP는 즉시 폐기 (one-time).
 * 실패 시 attempts++, MAX_ATTEMPTS 초과 시 폐기 + too_many_attempts.
 */
export async function verifyOtp(phone: string, otp: string): Promise<VerifyResult> {
  return withKeyLock(`${LOCK_PREFIX}${phone}`, async () => {
    const all = await loadAll();
    const idx = all.findIndex((r) => r.phone === phone);
    if (idx === -1) {
      return { ok: false, reason: 'not_found' };
    }

    const record = all[idx];

    if (record.expiresAt <= Date.now()) {
      all.splice(idx, 1);
      await saveAll(all);
      return { ok: false, reason: 'expired' };
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      all.splice(idx, 1);
      await saveAll(all);
      return { ok: false, reason: 'too_many_attempts' };
    }

    const expectedHash = hashOtp(phone, otp);
    // constant-time 비교 (sha256 hex → 같은 길이라 항상 안전)
    const a = Buffer.from(expectedHash, 'hex');
    const b = Buffer.from(record.otpHash, 'hex');
    const matched = a.length === b.length && timingSafeEqual(a, b);

    if (!matched) {
      record.attempts += 1;
      if (record.attempts >= MAX_ATTEMPTS) {
        all.splice(idx, 1);
        await saveAll(all);
        return { ok: false, reason: 'too_many_attempts' };
      }
      await saveAll(all);
      return { ok: false, reason: 'mismatch' };
    }

    // 성공 — 폐기
    all.splice(idx, 1);
    await saveAll(all);
    return { ok: true };
  });
}

export const OTP_CONFIG = { TTL_MS: OTP_TTL_MS, MAX_ATTEMPTS };
