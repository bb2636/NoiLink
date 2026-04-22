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
/**
 * 데모 기업의 소속 인원을 일괄 시드.
 * - 기관 리포트(소속 인원 현황), 랭킹(기업 필터), 분포 차트 등이 실제 데이터로 채워짐.
 * - 비밀번호 미발급(로그인 불가, 단순 표시용 계정).
 * - 멱등: 이미 동일 username + organizationId 가 있으면 건너뜀.
 */
const DEMO_ORG_MEMBERS: Array<{
  username: string;
  name: string;
  age: number;
  brainAge: number;
  brainimalType: User['brainimalType'];
  streak: number;
  daysAgoLastTraining: number;
}> = [
  { username: 'kim01',  name: '김순자', age: 78, brainAge: 76, brainimalType: 'FOX_BALANCED',     streak: 5, daysAgoLastTraining: 0 },
  { username: 'lee02',  name: '이영희', age: 82, brainAge: 84, brainimalType: 'BEAR_ENDURANCE',   streak: 3, daysAgoLastTraining: 1 },
  { username: 'park03', name: '박정수', age: 75, brainAge: 71, brainimalType: 'OWL_FOCUS',        streak: 8, daysAgoLastTraining: 0 },
  { username: 'choi04', name: '최말순', age: 80, brainAge: 81, brainimalType: 'KOALA_CALM',       streak: 2, daysAgoLastTraining: 2 },
  { username: 'jung05', name: '정복례', age: 77, brainAge: 75, brainimalType: 'FOX_BALANCED',     streak: 6, daysAgoLastTraining: 1 },
  { username: 'kang06', name: '강만수', age: 84, brainAge: 87, brainimalType: 'CHEETAH_JUDGMENT', streak: 1, daysAgoLastTraining: 4 },
  { username: 'shin07', name: '신옥자', age: 79, brainAge: 78, brainimalType: 'DOLPHIN_BRILLIANT',streak: 4, daysAgoLastTraining: 0 },
  { username: 'song08', name: '송상철', age: 76, brainAge: 73, brainimalType: 'TIGER_STRATEGIC',  streak: 7, daysAgoLastTraining: 1 },
  { username: 'oh09',   name: '오금자', age: 81, brainAge: 82, brainimalType: 'CAT_DELICATE',     streak: 2, daysAgoLastTraining: 3 },
  { username: 'yoon10', name: '윤덕수', age: 78, brainAge: 76, brainimalType: 'EAGLE_INSIGHT',    streak: 5, daysAgoLastTraining: 0 },
  { username: 'lim11',  name: '임순녀', age: 83, brainAge: 86, brainimalType: 'LION_BOLD',        streak: 1, daysAgoLastTraining: 5 },
  { username: 'han12',  name: '한봉수', age: 75, brainAge: 72, brainimalType: 'DOG_SOCIAL',       streak: 9, daysAgoLastTraining: 0 },
];

async function seedDemoOrgMembers(): Promise<void> {
  let memberIds: string[] = [];
  let adminUserId: string | undefined;
  await withKeyLock(KV_LOCK.USERS, async () => {
    const users: User[] = (await db.get('users')) || [];
    let added = 0;
    for (const m of DEMO_ORG_MEMBERS) {
      const exists = users.find(
        (u: any) => u.username === m.username && u.organizationId === ORG_ID,
      );
      if (exists) {
        memberIds.push((exists as any).id);
        continue;
      }
      const now = Date.now();
      const lastTraining = new Date(now - m.daysAgoLastTraining * 24 * 60 * 60 * 1000).toISOString();
      const newUser: User = {
        id: `org_member_${m.username}_${now}_${Math.random().toString(36).substr(2, 4)}`,
        username: m.username,
        email: `${m.username}@demo-org.local`,
        name: m.name,
        userType: 'ORGANIZATION',
        organizationId: ORG_ID,
        organizationName: ORG_NAME,
        approvalStatus: 'APPROVED',
        age: m.age,
        brainAge: m.brainAge,
        brainimalType: m.brainimalType,
        brainimalConfidence: 0.85,
        streak: m.streak,
        lastTrainingDate: lastTraining,
        createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        lastLoginAt: lastTraining,
        updatedAt: undefined,
      };
      users.push(newUser);
      memberIds.push(newUser.id);
      added += 1;
    }
    const admin = users.find((u: any) => u.email === ORG_EMAIL);
    if (admin) adminUserId = (admin as any).id;
    if (added > 0) {
      await db.set('users', users);
      console.log(`✅ Demo org members seeded: ${added}명 (organizationId=${ORG_ID})`);
    } else {
      console.log(`✅ Demo org members already present (organizationId=${ORG_ID})`);
    }
  });

  // 조직 레코드 동기화 (organization-members API가 organizations.memberUserIds 를 참조)
  const allMemberIds = adminUserId ? [adminUserId, ...memberIds] : memberIds;
  const organizations: any[] = (await db.get('organizations')) || [];
  const idx = organizations.findIndex((o: any) => o.id === ORG_ID);
  const orgRecord = {
    id: ORG_ID,
    name: ORG_NAME,
    memberUserIds: allMemberIds,
    createdAt: idx >= 0 ? organizations[idx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    organizations[idx] = { ...organizations[idx], ...orgRecord };
  } else {
    organizations.push(orgRecord);
  }
  await db.set('organizations', organizations);
}

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
      await seedDemoOrgMembers();
    } else {
      console.log('ℹ️  [seed-admin] PRODUCTION: 테스트/기업 계정 시드는 건너뜁니다.');
    }
  } catch (error) {
    console.error('❌ Failed to seed accounts:', error);
    throw error;
  }
}
