/**
 * 비밀번호 재설정용 단기 토큰
 *
 * - 32바이트 랜덤(hex 64자), TTL 15분
 * - DB에는 sha256 hash만 저장 — 탈취 대비
 * - 사용 즉시 폐기 (one-time)
 * - JWT 미사용 (revoke 불가 + 탈취 시 위험)
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db } from '../db.js';
import { withKeyLock } from './key-mutex.js';

const LOCK_KEY = 'lock:reset-token';

const TOKEN_KEY = 'password_reset_tokens';
const TOKEN_TTL_MS = 15 * 60 * 1000;

export interface ResetTokenRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function loadAll(): Promise<ResetTokenRecord[]> {
  const list = await db.get(TOKEN_KEY) || [];
  const now = Date.now();
  return (list as ResetTokenRecord[]).filter((r) => r.expiresAt > now);
}

async function saveAll(list: ResetTokenRecord[]): Promise<void> {
  await db.set(TOKEN_KEY, list);
}

/**
 * 신규 토큰 발급. 같은 userId의 기존 토큰은 무효화됨.
 * @returns 평문 토큰 (호출자가 클라이언트에 1회만 전달)
 */
export async function issueResetToken(userId: string): Promise<string> {
  return withKeyLock(LOCK_KEY, async () => {
    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = Date.now();

    const all = await loadAll();
    const filtered = all.filter((r) => r.userId !== userId);
    filtered.push({
      tokenHash,
      userId,
      expiresAt: now + TOKEN_TTL_MS,
      createdAt: now,
    });
    await saveAll(filtered);

    return token;
  });
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' };

/**
 * 토큰 사용 (검증 + 즉시 폐기).
 */
export async function consumeResetToken(token: string): Promise<ConsumeResult> {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'invalid' };
  }

  return withKeyLock(LOCK_KEY, async () => {
    const tokenHash = hashToken(token);
    const all = await loadAll();
    // constant-time 검색: 모든 레코드와 비교 (단축 평가 회피)
    let foundIdx = -1;
    const target = Buffer.from(tokenHash, 'hex');
    for (let i = 0; i < all.length; i++) {
      const candidate = Buffer.from(all[i].tokenHash, 'hex');
      if (candidate.length === target.length && timingSafeEqual(candidate, target)) {
        foundIdx = i;
      }
    }
    if (foundIdx === -1) {
      return { ok: false, reason: 'invalid' };
    }

    const record = all[foundIdx];
    all.splice(foundIdx, 1);
    await saveAll(all);

    if (record.expiresAt <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, userId: record.userId };
  });
}

export const RESET_TOKEN_CONFIG = { TTL_MS: TOKEN_TTL_MS };
