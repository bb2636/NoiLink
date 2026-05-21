/**
 * KV `terms` → 정규화 `terms` 테이블 1회 멱등 마이그레이션 (2026-05).
 *
 * 배경: Task #157/#158 정규화 리팩토링에서 새 entity 는 정규화 테이블 + repository
 * 헬퍼로 시작하지만, 기존 KV `terms` 키에 들어있던 약관은 자동 이전이 빠져 있었다.
 * dev 는 admin UI 로 재입력해서 정규화 테이블에 데이터가 있었지만, prod publish
 * 후 정규화 `terms` 테이블이 비어있어 회원가입 약관 모달이 "불러오는 중"에서
 * 멈추는 회귀가 발생.
 *
 * 동작: Postgres 백엔드이고, 정규화 `terms` 가 비어있을 때만 KV 데이터를 일괄
 * upsert. 멱등이므로 매 부팅 시 안전.
 */
import { db } from '../db.js';
import { isPostgresBackend, getPool } from '../db/repositories/util.js';
import { upsertTerms } from '../db/repositories/terms.js';
import type { Terms } from '@noilink/shared';

export async function migrateKvTermsToNormalized(): Promise<void> {
  if (!(await isPostgresBackend())) return;

  const pool = await getPool();
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM terms');
  if ((rows[0]?.c ?? 0) > 0) return;

  const kvTerms = (await db.get('terms')) as Terms[] | null;
  if (!kvTerms || !Array.isArray(kvTerms) || kvTerms.length === 0) return;

  let migrated = 0;
  for (const t of kvTerms) {
    if (!t || !t.id || !t.type) continue;
    try {
      await upsertTerms(t);
      migrated += 1;
    } catch (err) {
      console.error(`⚠️  KV terms 마이그레이션 실패 (id=${t.id}):`, err);
    }
  }
  if (migrated > 0) {
    console.log(`✅ Migrated ${migrated} terms from kv_store → normalized table`);
  }
}
