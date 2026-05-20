/**
 * Task #157: kv_store JSON 배열 → 정규화 테이블 데이터 이전 스크립트
 *
 * 단방향, 멱등.
 *  - kv_store 의 각 키 (users, sessions, metricsScores, rawMetrics, rankings,
 *    reports, organizationInsightReports, dailyConditions, dailyMissions,
 *    bleAbortEvents, ackBannerEvents, organizations, passwords, terms,
 *    inquiries) 를 읽어 해당 정규화 테이블에 INSERT ... ON CONFLICT DO UPDATE.
 *  - kv_store 원본은 삭제하지 않는다 (idempotency / normConfig / migrations
 *    같은 진짜 KV 용도와 함께 남아 있으며, 정규화 테이블이 검증되기 전까지의
 *    안전망 역할).
 *
 * 사용:
 *   DATABASE_URL=... node scripts/migrate-kv-to-normalized.mjs
 *
 * 부팅 시 자동 실행은 하지 않는다 — 명시적 실행을 통해 멱등성과 검증을 분리한다.
 */

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 미설정');
  process.exit(1);
}

const sslDisabled = /[?&]sslmode=disable(\b|&)/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

// schema.sql 도 함께 적용 — 정규화 테이블이 아직 없을 수도 있다.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, '..', 'server', 'db', 'schema.sql');
const schemaSql = await readFile(schemaPath, 'utf-8');
await pool.query(schemaSql);
console.log('✓ schema.sql 적용 완료');

async function kvGet(key) {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  if (rows.length === 0) return null;
  const v = rows[0].value;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

const stats = {};
function bump(label, key) {
  if (!stats[label]) stats[label] = {};
  stats[label][key] = (stats[label][key] || 0) + 1;
}

// ──────────────────────────────────────────────────────────────
// 1. users
// ──────────────────────────────────────────────────────────────
{
  const users = (await kvGet('users')) || [];
  for (const u of users) {
    const known = new Set([
      'id', 'username', 'email', 'name', 'nickname', 'phone', 'age', 'userType',
      'organizationId', 'deviceId', 'brainimalType', 'brainimalConfidence', 'brainAge',
      'previousBrainAge', 'streak', 'bestStreak', 'lastTrainingDate', 'createdAt',
      'lastLoginAt', 'updatedAt', 'isDeleted', 'organizationName', 'approvalStatus',
      'documents', 'pendingOrganizationId', 'pendingOrganizationName',
      'pendingRequestedAt', 'socialProvider', 'socialId',
    ]);
    const extra = {};
    for (const k of Object.keys(u)) if (!known.has(k)) extra[k] = u[k];
    try {
      await pool.query(
        `INSERT INTO users (
          id, username, email, name, nickname, phone, age, user_type, organization_id,
          device_id, brainimal_type, brainimal_confidence, brain_age, previous_brain_age,
          streak, best_streak, last_training_date, created_at, last_login_at, updated_at,
          is_deleted, organization_name, approval_status, documents,
          pending_organization_id, pending_organization_name, pending_requested_at,
          social_provider, social_id, extra
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          username=EXCLUDED.username, email=EXCLUDED.email, name=EXCLUDED.name,
          nickname=EXCLUDED.nickname, phone=EXCLUDED.phone, age=EXCLUDED.age,
          user_type=EXCLUDED.user_type, organization_id=EXCLUDED.organization_id,
          device_id=EXCLUDED.device_id, brainimal_type=EXCLUDED.brainimal_type,
          brainimal_confidence=EXCLUDED.brainimal_confidence, brain_age=EXCLUDED.brain_age,
          previous_brain_age=EXCLUDED.previous_brain_age, streak=EXCLUDED.streak,
          best_streak=EXCLUDED.best_streak, last_training_date=EXCLUDED.last_training_date,
          last_login_at=EXCLUDED.last_login_at, updated_at=EXCLUDED.updated_at,
          is_deleted=EXCLUDED.is_deleted, organization_name=EXCLUDED.organization_name,
          approval_status=EXCLUDED.approval_status, documents=EXCLUDED.documents,
          pending_organization_id=EXCLUDED.pending_organization_id,
          pending_organization_name=EXCLUDED.pending_organization_name,
          pending_requested_at=EXCLUDED.pending_requested_at,
          social_provider=EXCLUDED.social_provider, social_id=EXCLUDED.social_id,
          extra=EXCLUDED.extra`,
        [
          u.id, u.username, u.email ?? null, u.name, u.nickname ?? null,
          u.phone ?? null, u.age ?? null, u.userType, u.organizationId ?? null,
          u.deviceId ?? null, u.brainimalType ?? null, u.brainimalConfidence ?? null,
          u.brainAge ?? null, u.previousBrainAge ?? null, u.streak ?? 0,
          u.bestStreak ?? null, u.lastTrainingDate ?? null, u.createdAt,
          u.lastLoginAt ?? null, u.updatedAt ?? null, u.isDeleted ?? false,
          u.organizationName ?? null, u.approvalStatus ?? null,
          u.documents ? JSON.stringify(u.documents) : null,
          u.pendingOrganizationId ?? null, u.pendingOrganizationName ?? null,
          u.pendingRequestedAt ?? null, u.socialProvider ?? null,
          u.socialId ?? null,
          Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
        ]
      );
      bump('users', 'ok');
    } catch (e) {
      console.error(`✗ users ${u.id}:`, e.message);
      bump('users', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 2. passwords
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('passwords')) || [];
  for (const p of items) {
    try {
      await pool.query(
        `INSERT INTO passwords (user_id, email, password_hash, must_change, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
           must_change=EXCLUDED.must_change, updated_at=EXCLUDED.updated_at`,
        [
          p.userId, p.email ?? null, p.password ?? p.passwordHash,
          p.mustChange ?? false, p.createdAt ?? new Date().toISOString(),
          p.updatedAt ?? null,
        ]
      );
      bump('passwords', 'ok');
    } catch (e) {
      console.error(`✗ passwords ${p.userId}:`, e.message);
      bump('passwords', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 3. organizations
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('organizations')) || [];
  for (const o of items) {
    const known = new Set(['id', 'name', 'adminUserId', 'memberUserIds', 'createdAt', 'updatedAt']);
    const extra = {};
    for (const k of Object.keys(o)) if (!known.has(k)) extra[k] = o[k];
    try {
      await pool.query(
        `INSERT INTO organizations (id, name, admin_user_id, member_user_ids, created_at, updated_at, extra)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, admin_user_id=EXCLUDED.admin_user_id,
           member_user_ids=EXCLUDED.member_user_ids, updated_at=EXCLUDED.updated_at,
           extra=EXCLUDED.extra`,
        [
          o.id, o.name, o.adminUserId ?? null,
          JSON.stringify(o.memberUserIds ?? []),
          o.createdAt ?? new Date().toISOString(), o.updatedAt ?? null,
          Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
        ]
      );
      bump('organizations', 'ok');
    } catch (e) {
      console.error(`✗ organizations ${o.id}:`, e.message);
      bump('organizations', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 4. terms
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('terms')) || [];
  for (const t of items) {
    try {
      await pool.query(
        `INSERT INTO terms (id, type, title, content, version, is_required, is_active, created_at, updated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           type=EXCLUDED.type, title=EXCLUDED.title, content=EXCLUDED.content,
           version=EXCLUDED.version, is_required=EXCLUDED.is_required,
           is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at,
           created_by=EXCLUDED.created_by`,
        [
          t.id, t.type, t.title, t.content, t.version,
          t.isRequired ?? true, t.isActive ?? true,
          t.createdAt ?? new Date().toISOString(), t.updatedAt ?? null,
          t.createdBy ?? null,
        ]
      );
      bump('terms', 'ok');
    } catch (e) {
      console.error(`✗ terms ${t.id}:`, e.message);
      bump('terms', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 5. sessions
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('sessions')) || [];
  for (const s of items) {
    try {
      await pool.query(
        `INSERT INTO sessions (id, user_id, mode, bpm, level, duration, score, is_composite, is_valid, phases, meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
         ON CONFLICT (id) DO UPDATE SET
           user_id=EXCLUDED.user_id, mode=EXCLUDED.mode, bpm=EXCLUDED.bpm,
           level=EXCLUDED.level, duration=EXCLUDED.duration, score=EXCLUDED.score,
           is_composite=EXCLUDED.is_composite, is_valid=EXCLUDED.is_valid,
           phases=EXCLUDED.phases, meta=EXCLUDED.meta`,
        [
          s.id, s.userId, s.mode, s.bpm, s.level, s.duration, s.score ?? null,
          s.isComposite ?? false, s.isValid ?? true,
          s.phases ? JSON.stringify(s.phases) : null,
          s.meta ? JSON.stringify(s.meta) : null,
          s.createdAt,
        ]
      );
      bump('sessions', 'ok');
    } catch (e) {
      console.error(`✗ sessions ${s.id}:`, e.message);
      bump('sessions', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 6. metricsScores
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('metricsScores')) || [];
  for (const m of items) {
    try {
      await pool.query(
        `INSERT INTO metrics_scores (session_id, user_id, memory, comprehension, focus, judgment, agility, endurance, rhythm, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (session_id) DO UPDATE SET
           user_id=EXCLUDED.user_id, memory=EXCLUDED.memory, comprehension=EXCLUDED.comprehension,
           focus=EXCLUDED.focus, judgment=EXCLUDED.judgment, agility=EXCLUDED.agility,
           endurance=EXCLUDED.endurance, rhythm=EXCLUDED.rhythm`,
        [
          m.sessionId, m.userId, m.memory ?? null, m.comprehension ?? null,
          m.focus ?? null, m.judgment ?? null, m.agility ?? null,
          m.endurance ?? null, m.rhythm ?? null,
          m.createdAt ?? new Date().toISOString(),
        ]
      );
      bump('metricsScores', 'ok');
    } catch (e) {
      console.error(`✗ metricsScores ${m.sessionId}:`, e.message);
      bump('metricsScores', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 7. rawMetrics
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('rawMetrics')) || [];
  for (const r of items) {
    try {
      await pool.query(
        `INSERT INTO raw_metrics (
          session_id, user_id, touch_count, hit_count, rt_mean, rt_sd,
          by_mode_metrics, rhythm, memory, comprehension, focus, judgment, agility, endurance, recovery,
          created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
          $16
        )
        ON CONFLICT (session_id) DO UPDATE SET
          user_id=EXCLUDED.user_id, touch_count=EXCLUDED.touch_count, hit_count=EXCLUDED.hit_count,
          rt_mean=EXCLUDED.rt_mean, rt_sd=EXCLUDED.rt_sd,
          by_mode_metrics=EXCLUDED.by_mode_metrics, rhythm=EXCLUDED.rhythm,
          memory=EXCLUDED.memory, comprehension=EXCLUDED.comprehension,
          focus=EXCLUDED.focus, judgment=EXCLUDED.judgment,
          agility=EXCLUDED.agility, endurance=EXCLUDED.endurance, recovery=EXCLUDED.recovery`,
        [
          r.sessionId, r.userId, r.touchCount ?? null, r.hitCount ?? null,
          r.rtMean ?? null, r.rtSD ?? null,
          r.byModeMetrics ? JSON.stringify(r.byModeMetrics) : null,
          r.rhythm ? JSON.stringify(r.rhythm) : null,
          r.memory ? JSON.stringify(r.memory) : null,
          r.comprehension ? JSON.stringify(r.comprehension) : null,
          r.focus ? JSON.stringify(r.focus) : null,
          r.judgment ? JSON.stringify(r.judgment) : null,
          r.agility ? JSON.stringify(r.agility) : null,
          r.endurance ? JSON.stringify(r.endurance) : null,
          r.recovery ? JSON.stringify(r.recovery) : null,
          r.createdAt ?? new Date().toISOString(),
        ]
      );
      bump('rawMetrics', 'ok');
    } catch (e) {
      console.error(`✗ rawMetrics ${r.sessionId}:`, e.message);
      bump('rawMetrics', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 8. rankings (truncate & reinsert)
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('rankings')) || [];
  if (items.length > 0) {
    await pool.query('DELETE FROM rankings');
    for (const e of items) {
      try {
        await pool.query(
          `INSERT INTO rankings (id, user_id, organization_id, ranking_type, score, rank, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)`,
          [
            e.id ?? `${e.rankingType}_${e.userId ?? 'unknown'}_${e.rank ?? 0}`,
            e.userId ?? null, e.organizationId ?? null, e.rankingType ?? null,
            e.score ?? null, e.rank ?? null, JSON.stringify(e),
          ]
        );
        bump('rankings', 'ok');
      } catch (err) {
        console.error('✗ rankings:', err.message);
        bump('rankings', 'fail');
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 9. reports
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('reports')) || [];
  for (const rpt of items) {
    const { id, userId, reportVersion, brainimalType, confidence, createdAt, ...rest } = rpt;
    try {
      await pool.query(
        `INSERT INTO reports (id, user_id, report_version, brainimal_type, confidence, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (id) DO UPDATE SET
           report_version=EXCLUDED.report_version, brainimal_type=EXCLUDED.brainimal_type,
           confidence=EXCLUDED.confidence, payload=EXCLUDED.payload`,
        [
          id, userId, reportVersion ?? null, brainimalType ?? null,
          confidence ?? null, JSON.stringify(rest),
          createdAt ?? new Date().toISOString(),
        ]
      );
      bump('reports', 'ok');
    } catch (e) {
      console.error(`✗ reports ${id}:`, e.message);
      bump('reports', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 10. organizationInsightReports
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('organizationInsightReports')) || [];
  for (const rpt of items) {
    const { id, organizationId, createdAt, ...rest } = rpt;
    try {
      await pool.query(
        `INSERT INTO org_insight_reports (id, organization_id, payload, created_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload`,
        [id, organizationId, JSON.stringify(rest), createdAt ?? new Date().toISOString()]
      );
      bump('orgInsightReports', 'ok');
    } catch (e) {
      console.error(`✗ orgInsightReports ${id}:`, e.message);
      bump('orgInsightReports', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 11. dailyConditions / dailyMissions
// ──────────────────────────────────────────────────────────────
{
  const items = (await kvGet('dailyConditions')) || [];
  for (const c of items) {
    const { userId, date, ...rest } = c;
    try {
      await pool.query(
        `INSERT INTO daily_conditions (user_id, date, payload, calculated_at)
         VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, date) DO UPDATE SET payload=EXCLUDED.payload`,
        [userId, date, JSON.stringify(rest)]
      );
      bump('dailyConditions', 'ok');
    } catch (e) {
      console.error(`✗ dailyConditions ${userId}/${date}:`, e.message);
      bump('dailyConditions', 'fail');
    }
  }
}
{
  const items = (await kvGet('dailyMissions')) || [];
  for (const m of items) {
    const { userId, date, ...rest } = m;
    try {
      await pool.query(
        `INSERT INTO daily_missions (user_id, date, payload, created_at)
         VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, date) DO UPDATE SET payload=EXCLUDED.payload`,
        [userId, date, JSON.stringify(rest)]
      );
      bump('dailyMissions', 'ok');
    } catch (e) {
      console.error(`✗ dailyMissions ${userId}/${date}:`, e.message);
      bump('dailyMissions', 'fail');
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 12. ble_abort_events / ack_banner_events / inquiries
// ──────────────────────────────────────────────────────────────
async function importEvents(kvKey, table) {
  const items = (await kvGet(kvKey)) || [];
  // 멱등성 보장: id 가 없는 레거시 이벤트는 페이로드 전체 fingerprint(SHA-1) 로
  // deterministic id 를 만든다. 같은 row 를 다시 import 해도 같은 id → ON CONFLICT
  // DO UPDATE 가 새 row 를 만들지 않고 in-place 업데이트만 한다.
  const { createHash } = await import('node:crypto');
  for (const idx of items.keys()) {
    const ev = items[idx];
    const { id, userId, sessionId, createdAt, ...rest } = ev;
    const stableId =
      id ??
      `${kvKey}_${createHash('sha1')
        .update(JSON.stringify({ userId, sessionId, createdAt, rest, idx }))
        .digest('hex')
        .slice(0, 24)}`;
    try {
      await pool.query(
        `INSERT INTO ${table} (id, user_id, session_id, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload`,
        [
          stableId,
          userId ?? null, sessionId ?? null, JSON.stringify(rest),
          createdAt ?? new Date().toISOString(),
        ]
      );
      bump(kvKey, 'ok');
    } catch (e) {
      console.error(`✗ ${kvKey}:`, e.message);
      bump(kvKey, 'fail');
    }
  }
}
await importEvents('bleAbortEvents', 'ble_abort_events');
await importEvents('ackBannerEvents', 'ack_banner_events');
await importEvents('inquiries', 'inquiries');

// ──────────────────────────────────────────────────────────────
// 결과
// ──────────────────────────────────────────────────────────────
console.log('\n=== 마이그레이션 결과 ===');
for (const [label, counts] of Object.entries(stats)) {
  const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ');
  console.log(`  ${label.padEnd(22)} ${parts}`);
}

console.log('\n=== 정규화 테이블 행 수 ===');
const tables = [
  'users', 'passwords', 'organizations', 'terms',
  'sessions', 'metrics_scores', 'raw_metrics', 'rankings',
  'reports', 'org_insight_reports', 'daily_conditions', 'daily_missions',
  'ble_abort_events', 'ack_banner_events', 'inquiries',
];
for (const t of tables) {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(22)} ${rows[0].n}`);
  } catch (e) {
    console.log(`  ${t.padEnd(22)} (error: ${e.message})`);
  }
}

await pool.end();
console.log('\n완료.');
