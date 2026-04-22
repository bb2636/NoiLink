import { db } from '../db.js';
import { hashPassword } from './password.js';
import { withKeyLock } from './key-mutex.js';
import type { User } from '@noilink/shared';

// 라우트와 동일한 lock 키 사용 (lock ordering 일관성)
const KV_LOCK = {
  USERS: 'lock:db:users',
  PASSWORDS: 'lock:db:passwords',
};

const isProduction = process.env.NODE_ENV === 'production';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_ENV = process.env.ADMIN_PASSWORD;
// 운영: ADMIN_PASSWORD 시크릿 미설정 시 fallback 금지
// 개발: 'admin1234' fallback 허용 (편의)
const ADMIN_PASSWORD = ADMIN_PASSWORD_ENV || (isProduction ? '' : 'admin1234');

const TEST_EMAIL = 'test@test.com';
const TEST_USERNAME = 'test';
const TEST_PASSWORD = 'test1234';

const ORG_EMAIL = 'org@org.com';
const ORG_USERNAME = 'org';
const ORG_PASSWORD = 'org1234';
const ORG_ID = 'demo-org-001';
const ORG_NAME = '데모 기업';

/**
 * 시드된 비밀번호가 약한지 판정.
 * - 환경변수가 아닌 코드 내 fallback 값 (admin1234 / test1234) 일 때 true.
 * - true면 password 레코드에 mustChange=true 플래그를 박아 로그인 후 강제 변경 안내.
 */
function isWeakSeedPassword(password: string): boolean {
  return password === 'admin1234' || password === 'test1234' || password === 'org1234';
}

async function seedUser(opts: {
  email: string;
  username: string;
  password: string;
  name: string;
  userType: 'ADMIN' | 'PERSONAL' | 'ORGANIZATION';
  organizationId?: string;
  organizationName?: string;
}): Promise<void> {
  // 락 안에서 존재 확인 + push
  const created = await withKeyLock(KV_LOCK.USERS, async (): Promise<User | null> => {
    const users = await db.get('users') || [];
    const exists = users.find((u: any) =>
      u.email === opts.email ||
      (u.username === opts.username && u.userType === opts.userType)
    );
    if (exists) return null;

    const newUser: User = createUserShape(opts);
    users.push(newUser);
    await db.set('users', users);
    return newUser;
  });

  if (!created) {
    console.log(`✅ ${opts.userType} account already exists: ${opts.email}`);
    return;
  }
  const newUser = created;
  await withKeyLock(KV_LOCK.PASSWORDS, async () => {
    const hashed = await hashPassword(opts.password);
    const passwords = await db.get('passwords') || [];
    const mustChange = isWeakSeedPassword(opts.password);
    passwords.push({
      userId: newUser.id,
      email: opts.email,
      password: hashed,
      mustChange,
      createdAt: new Date().toISOString(),
    });
    await db.set('passwords', passwords);
    console.log(
      `✅ ${opts.userType} account created: ${opts.email}` +
        (mustChange ? ' ⚠️  (weak default password — mustChange=true)' : ''),
    );
  });
}

function createUserShape(opts: {
  email: string;
  username: string;
  name: string;
  userType: 'ADMIN' | 'PERSONAL' | 'ORGANIZATION';
  organizationId?: string;
  organizationName?: string;
}): User {
  return {
    id: `${opts.userType.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    username: opts.username,
    email: opts.email,
    name: opts.name,
    userType: opts.userType,
    organizationId: opts.organizationId,
    organizationName: opts.organizationName,
    approvalStatus: opts.userType === 'ORGANIZATION' ? 'APPROVED' : undefined,
    deviceId: undefined,
    brainimalType: undefined,
    brainimalConfidence: undefined,
    brainAge: undefined,
    previousBrainAge: undefined,
    streak: 0,
    lastTrainingDate: undefined,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    updatedAt: undefined,
  };
}

/**
 * 마이그레이션: 이미 시드된 admin/test 계정의 password 레코드에 mustChange 플래그가 없으면 추가.
 * (이전 배포에서 생성된 약한 비밀번호 계정 보호)
 */
async function backfillMustChangeFlag(): Promise<void> {
  // users는 read-only이므로 락 불필요. passwords는 RMW이므로 PASSWORDS 락으로 보호.
  await withKeyLock(KV_LOCK.PASSWORDS, async () => {
    const users = await db.get('users') || [];
    const passwords = await db.get('passwords') || [];
    const targets = [ADMIN_EMAIL, TEST_EMAIL];
    let changed = false;
    for (const email of targets) {
      const u = users.find((x: any) => x.email === email);
      if (!u) continue;
      const p = passwords.find((x: any) => x.userId === u.id);
      if (p && p.mustChange === undefined) {
        p.mustChange = true; // 약한 시드라고 가정 (안전하게 강제 변경 안내)
        changed = true;
        console.log(`⚠️  [migration] mustChange=true 부여: ${email}`);
      }
    }
    if (changed) {
      await db.set('passwords', passwords);
    }
  });
}

export async function seedAdminAccount(): Promise<void> {
  try {
    await backfillMustChangeFlag();

    if (isProduction && !ADMIN_PASSWORD_ENV) {
      console.warn(
        '⚠️  [seed-admin] PRODUCTION: ADMIN_PASSWORD 시크릿이 설정되지 않아 admin 시드를 건너뜁니다.\n' +
        '    운영에서 admin 계정이 필요하면 ADMIN_PASSWORD 시크릿을 설정한 뒤 재시작하세요.'
      );
    } else {
      await seedUser({
        email: ADMIN_EMAIL,
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        name: '관리자',
        userType: 'ADMIN',
      });
    }

    if (!isProduction) {
      await seedUser({
        email: TEST_EMAIL,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        name: '테스트 사용자',
        userType: 'PERSONAL',
      });
      await seedUser({
        email: ORG_EMAIL,
        username: ORG_USERNAME,
        password: ORG_PASSWORD,
        name: '데모 기업 관리자',
        userType: 'ORGANIZATION',
        organizationId: ORG_ID,
        organizationName: ORG_NAME,
      });
    } else {
      console.log('ℹ️  [seed-admin] PRODUCTION: 테스트/기업 계정 시드는 건너뜁니다.');
    }
  } catch (error) {
    console.error('❌ Failed to seed accounts:', error);
    throw error;
  }
}
