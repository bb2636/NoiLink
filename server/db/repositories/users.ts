/**
 * users repository (Task #157)
 *
 * 모든 SQL 은 parameterized.
 * 입력/반환 타입은 shared 의 User. snake_case ↔ camelCase 매핑은 row↔record helper 가 처리.
 */
import type { User, UserType, BrainimalType } from '@noilink/shared';
import { getPool, rowToCamel, rowsToCamel } from './util.js';

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
  // timestamps → ISO string
  for (const k of ['createdAt', 'lastLoginAt', 'updatedAt', 'lastTrainingDate', 'pendingRequestedAt']) {
    if (camel[k] instanceof Date) camel[k] = camel[k].toISOString();
  }
  // extra 머지 (회원 가입 후 추가된 임의 필드 보존)
  if (camel.extra && typeof camel.extra === 'object') {
    const extra = camel.extra;
    delete camel.extra;
    return { ...extra, ...camel } as User;
  }
  delete camel.extra;
  return camel as User;
}

export async function findUserById(id: string): Promise<User | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rowToUser(rows[0]);
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 LIMIT 1`,
    [username]
  );
  return rowToUser(rows[0]);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rowToUser(rows[0]);
}

export async function findUserBySocial(
  provider: string,
  socialId: string
): Promise<User | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE social_provider = $1 AND social_id = $2 LIMIT 1`,
    [provider, socialId]
  );
  return rowToUser(rows[0]);
}

export async function listUsersByOrganization(
  organizationId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<User[]> {
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
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE user_type = $1 ORDER BY created_at ASC`,
    [userType]
  );
  return rows.map((r) => rowToUser(r)!).filter(Boolean);
}

export async function listAllUsers(opts: { includeDeleted?: boolean } = {}): Promise<User[]> {
  const pool = await getPool();
  const where = opts.includeDeleted ? '' : 'WHERE COALESCE(is_deleted, FALSE) = FALSE';
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users ${where} ORDER BY created_at ASC`
  );
  return rows.map((r) => rowToUser(r)!).filter(Boolean);
}

export async function countUsers(opts: { includeDeleted?: boolean } = {}): Promise<number> {
  const pool = await getPool();
  const where = opts.includeDeleted ? '' : 'WHERE COALESCE(is_deleted, FALSE) = FALSE';
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users ${where}`);
  return rows[0]?.n ?? 0;
}

/** insert 또는 update (id PK 기준). User 객체의 모든 알려진 컬럼을 평탄화하고
 *  나머지는 extra JSONB 에 보관. */
export async function upsertUser(user: User): Promise<void> {
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

export async function deleteUser(id: string): Promise<void> {
  const pool = await getPool();
  await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
}

export async function softDeleteUser(id: string): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `UPDATE users SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id]
  );
}
