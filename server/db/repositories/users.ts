/**
 * users repository (Task #157 + Task #158 dual-mode)
 */
import type { User, UserType } from '@noilink/shared';
import {
  getPool, rowToCamel, isPostgresBackend,
  kvGetCollection, kvUpsert, kvDelete,
} from './util.js';

const KV = 'users';

const USER_COLUMNS = `
  id, username, email, name, nickname, phone, age, user_type, organization_id,
  device_id, brainimal_type, brainimal_confidence, brain_age, previous_brain_age,
  streak, best_streak, last_training_date, created_at, last_login_at, updated_at,
  is_deleted, organization_name, approval_status, documents,
  pending_organization_id, pending_organization_name, pending_requested_at,
  social_provider, social_id, extra
`;

function rowToUser(row: any): User | null {
  if (!row) return null;
  const camel = rowToCamel<any>(row)!;
  for (const k of ['createdAt', 'lastLoginAt', 'updatedAt', 'lastTrainingDate', 'pendingRequestedAt']) {
    if (camel[k] instanceof Date) camel[k] = camel[k].toISOString();
  }
  if (camel.extra && typeof camel.extra === 'object') {
    const extra = camel.extra;
    delete camel.extra;
    return { ...extra, ...camel } as User;
  }
  delete camel.extra;
  return camel as User;
}

export async function findUserById(id: string): Promise<User | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.find((u) => u.id === id) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [id]
  );
  return rowToUser(rows[0]);
}

export async function findUserByUsername(username: string): Promise<User | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.find((u) => u.username === username) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 LIMIT 1`, [username]
  );
  return rowToUser(rows[0]);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.find((u) => u.email === email) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`, [email]
  );
  return rowToUser(rows[0]);
}

export async function findUserByPhone(phoneDigits: string): Promise<User | null> {
  // phoneDigits 는 normalize 된 숫자 문자열 (예: "01012345678").
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.find((u: any) =>
      u.phone && String(u.phone).replace(/[^0-9]/g, '') === phoneDigits
    ) ?? null;
  }
  const pool = await getPool();
  // DB 에 저장된 phone 도 보통 숫자 only 이지만, hyphen 포함 데이터가 섞였을 가능성을 가드.
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users
     WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $1
     LIMIT 1`,
    [phoneDigits]
  );
  return rowToUser(rows[0]);
}

export async function findUserBySocial(
  provider: string, socialId: string
): Promise<User | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.find((u: any) => u.socialProvider === provider && u.socialId === socialId) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE social_provider = $1 AND social_id = $2 LIMIT 1`,
    [provider, socialId]
  );
  return rowToUser(rows[0]);
}

export async function listUsersByOrganization(
  organizationId: string, opts: { includeDeleted?: boolean } = {}
): Promise<User[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.filter((u) => u.organizationId === organizationId
      && (opts.includeDeleted || !u.isDeleted));
  }
  const pool = await getPool();
  const where = opts.includeDeleted
    ? 'organization_id = $1'
    : 'organization_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE';
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE ${where} ORDER BY created_at ASC`,
    [organizationId]
  );
  return rows.map((r) => rowToUser(r)!).filter(Boolean);
}

export async function listUsersByType(userType: UserType): Promise<User[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return all.filter((u) => u.userType === userType);
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE user_type = $1 ORDER BY created_at ASC`,
    [userType]
  );
  return rows.map((r) => rowToUser(r)!).filter(Boolean);
}

export async function listAllUsers(opts: { includeDeleted?: boolean } = {}): Promise<User[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    return opts.includeDeleted ? all : all.filter((u) => !u.isDeleted);
  }
  const pool = await getPool();
  const where = opts.includeDeleted ? '' : 'WHERE COALESCE(is_deleted, FALSE) = FALSE';
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users ${where} ORDER BY created_at ASC`
  );
  return rows.map((r) => rowToUser(r)!).filter(Boolean);
}

export async function countUsers(opts: { includeDeleted?: boolean } = {}): Promise<number> {
  if (!(await isPostgresBackend())) {
    const all = await listAllUsers(opts);
    return all.length;
  }
  const pool = await getPool();
  const where = opts.includeDeleted ? '' : 'WHERE COALESCE(is_deleted, FALSE) = FALSE';
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users ${where}`);
  return rows[0]?.n ?? 0;
}

export async function upsertUser(user: User): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<User>(KV, user, (u) => u.id === user.id);
    return;
  }
  const pool = await getPool();
  const known = new Set([
    'id', 'username', 'email', 'name', 'nickname', 'phone', 'age', 'userType',
    'organizationId', 'deviceId', 'brainimalType', 'brainimalConfidence', 'brainAge',
    'previousBrainAge', 'streak', 'bestStreak', 'lastTrainingDate', 'createdAt',
    'lastLoginAt', 'updatedAt', 'isDeleted', 'organizationName', 'approvalStatus',
    'documents', 'pendingOrganizationId', 'pendingOrganizationName',
    'pendingRequestedAt', 'socialProvider', 'socialId',
  ]);
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(user)) {
    if (!known.has(k)) extra[k] = (user as any)[k];
  }
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
      user.id, user.username, user.email ?? null, user.name, user.nickname ?? null,
      user.phone ?? null, user.age ?? null, user.userType, user.organizationId ?? null,
      user.deviceId ?? null, user.brainimalType ?? null, user.brainimalConfidence ?? null,
      user.brainAge ?? null, user.previousBrainAge ?? null, user.streak ?? 0,
      user.bestStreak ?? null, user.lastTrainingDate ?? null, user.createdAt,
      user.lastLoginAt ?? null, user.updatedAt ?? null, user.isDeleted ?? false,
      user.organizationName ?? null, user.approvalStatus ?? null,
      user.documents ? JSON.stringify(user.documents) : null,
      user.pendingOrganizationId ?? null, user.pendingOrganizationName ?? null,
      user.pendingRequestedAt ?? null, user.socialProvider ?? null,
      user.socialId ?? null,
      Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
    ]
  );
}

export async function listUsersByIds(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    const set = new Set(ids);
    return all.filter((u) => set.has(u.id));
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1::text[])`, [ids]
  );
  return rows.map((r) => rowToUser(r)!).filter(Boolean);
}

export async function deleteUser(id: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvDelete<User>(KV, (u) => u.id === id);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
}

export async function softDeleteUser(id: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<User>(KV);
    const idx = all.findIndex((u) => u.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], isDeleted: true, updatedAt: new Date().toISOString() };
      await import('../../db.js').then(({ db }) => db.set(KV, all));
    }
    return;
  }
  const pool = await getPool();
  await pool.query(
    `UPDATE users SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]
  );
}
