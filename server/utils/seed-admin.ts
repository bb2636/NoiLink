import { hashPassword } from './password.js';
import { withKeyLock } from './key-mutex.js';
import type { MetricsScore, Session, User } from '@noilink/shared';
import {
  findUserByEmail,
  findUserById,
  findUserByUsername,
  listAllUsers,
  listUsersByOrganization,
  upsertUser,
} from '../db/repositories/users.js';
import {
  findPasswordByUserId,
  upsertPassword,
} from '../db/repositories/passwords.js';
import {
  findOrganizationById,
  upsertOrganization,
} from '../db/repositories/organizations.js';
import { listSessions, upsertSession } from '../db/repositories/sessions.js';
import { upsertMetricsScore } from '../db/repositories/metrics-scores.js';

const MS_DAY = 24 * 60 * 60 * 1000;

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
const ORG_NAME = 'nobuilder';

// 기업 관리자(데모 기업) 본인 목업 — 개인 화면(홈/마이페이지) 빈칸 방지
const ORG_ADMIN_MOCK = {
  brainimalType: 'OWL_FOCUS' as const,
  brainimalConfidence: 0.92,
  brainAge: 52,
  previousBrainAge: 55,
  streak: 12,
  bestStreak: 18,
  age: 54,
};

// 시연용: 기업에 소속된 PERSONAL 회원 (개인 화면 ↔ 기업 소속 화면 구분 확인)
const ORG_MEMBER_EMAIL = 'member@test.com';
const ORG_MEMBER_USERNAME = 'member';
const ORG_MEMBER_PASSWORD = 'member1234';
const ORG_MEMBER_NAME = '홍길동';

/**
 * 시드된 비밀번호가 약한지 판정.
 * - 환경변수가 아닌 코드 내 fallback 값 (admin1234 / test1234) 일 때 true.
 * - true면 password 레코드에 mustChange=true 플래그를 박아 로그인 후 강제 변경 안내.
 */
function isWeakSeedPassword(password: string): boolean {
  return (
    password === 'admin1234' ||
    password === 'test1234' ||
    password === 'org1234' ||
    password === 'member1234'
  );
}

async function seedUser(opts: {
  email: string;
  username: string;
  password: string;
  name: string;
  userType: 'ADMIN' | 'PERSONAL' | 'ORGANIZATION';
  organizationId?: string;
  organizationName?: string;
  extra?: Partial<User>;
}): Promise<void> {
  // 락 안에서 존재 확인 + upsert. 이미 있으면 기존 user 를 반환해 password 보정 단계로 진입.
  const { user, justCreated } = await withKeyLock(
    KV_LOCK.USERS,
    async (): Promise<{ user: User | null; justCreated: boolean }> => {
      const byEmail = await findUserByEmail(opts.email);
      if (byEmail) return { user: byEmail, justCreated: false };
      const byUsername = await findUserByUsername(opts.username);
      if (byUsername && byUsername.userType === opts.userType) {
        return { user: byUsername, justCreated: false };
      }

      const newUser: User = createUserShape(opts);
      await upsertUser(newUser);
      return { user: newUser, justCreated: true };
    },
  );

  if (!user) return;

  // password 가 없으면(이전 시드 중 크래시 등) 생성, 있으면 약한 시드 password 에 한해 mustChange 보정.
  await withKeyLock(KV_LOCK.PASSWORDS, async () => {
    const existingPwd = await findPasswordByUserId(user.id);
    const mustChange = isWeakSeedPassword(opts.password);

    if (!existingPwd) {
      const hashed = await hashPassword(opts.password);
      await upsertPassword({
        userId: user.id,
        email: opts.email,
        passwordHash: hashed,
        mustChange,
        createdAt: new Date().toISOString(),
      });
      console.log(
        `✅ ${opts.userType} account ${justCreated ? 'created' : 'password recovered'}: ${opts.email}` +
          (mustChange ? ' ⚠️  (weak default password — mustChange=true)' : ''),
      );
      return;
    }

    if (mustChange && existingPwd.mustChange !== true) {
      await upsertPassword({
        ...existingPwd,
        mustChange: true,
        updatedAt: new Date().toISOString(),
      });
      console.log(`⚠️  mustChange=true 보정: ${opts.email}`);
    } else if (!justCreated) {
      console.log(`✅ ${opts.userType} account already exists: ${opts.email}`);
    }
  });
}

function createUserShape(opts: {
  email: string;
  username: string;
  name: string;
  userType: 'ADMIN' | 'PERSONAL' | 'ORGANIZATION';
  organizationId?: string;
  organizationName?: string;
  extra?: Partial<User>;
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
    ...(opts.extra || {}),
  };
}

/**
 * 기존 시드 계정에 누락된 목업 필드(brainAge/brainimalType 등)를 패치.
 * - 사용자가 이미 본인 데이터를 갖고 있으면 덮어쓰지 않음 (필드별 빈 값일 때만 채움).
 */
async function patchUserMockData(
  email: string,
  patch: Partial<User>,
): Promise<void> {
  await withKeyLock(KV_LOCK.USERS, async () => {
    const current = await findUserByEmail(email);
    if (!current) return;
    let changed = false;
    const next: any = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      const cur = (current as any)[k];
      if (cur === undefined || cur === null || cur === 0) {
        next[k] = v;
        changed = true;
      }
    }
    if (changed) {
      next.updatedAt = new Date().toISOString();
      await upsertUser(next);
      console.log(`✅ Mock data patched for ${email}`);
    }
  });
}

/**
 * 시연용: 데모 기업에 소속된 PERSONAL 회원 시드.
 * - 기업 관리자가 트레이닝 진행 회원으로 선택 가능.
 * - approvalStatus 없이 organizationId 만으로 소속 처리(개인회원 → 기업 소속 형태).
 * - 조직 레코드의 memberUserIds 에 함께 등록.
 */
/**
 * 마이그레이션: 이미 시드된 demo-org 멤버(@demo-org.local)가
 * userType: 'ORGANIZATION' + approvalStatus: 'APPROVED' 로 들어가 있으면
 * PERSONAL 로 강제 패치한다. 관리자 페이지의 "기업회원" 탭에는 조직 admin
 * (org@org.com) 한 명만 남게 된다.
 *
 * - 멱등: 이미 PERSONAL 이면 no-op.
 * - 다른 cross-collection 변경과 직렬화하기 위해 USERS 락 안에서 수행.
 */
async function migrateDemoOrgMembersToPersonal(): Promise<void> {
  await withKeyLock(KV_LOCK.USERS, async () => {
    const all = await listAllUsers({ includeDeleted: true });
    const demoMembers = all.filter(
      (u) => typeof u.email === 'string' && u.email.endsWith('@demo-org.local'),
    );
    const demoCount = demoMembers.length;
    let changed = 0;
    for (const u of demoMembers) {
      const next: any = { ...u };
      let touched = false;
      if (u.userType === 'ORGANIZATION') {
        next.userType = 'PERSONAL';
        touched = true;
      }
      if (u.approvalStatus !== undefined) {
        next.approvalStatus = undefined;
        touched = true;
      }
      if (touched) {
        next.updatedAt = new Date().toISOString();
        await upsertUser(next);
        changed += 1;
      }
    }
    if (changed > 0) {
      console.log(`✅ Demo org members migrated to PERSONAL: ${changed}명 (총 ${demoCount}명 중)`);
    } else {
      console.log(`ℹ️  Demo org members migration: 변경 없음 (총 ${demoCount}명, 모두 이미 PERSONAL)`);
    }
  });
}

async function seedDemoOrgPersonalMember(): Promise<void> {
  await seedUser({
    email: ORG_MEMBER_EMAIL,
    username: ORG_MEMBER_USERNAME,
    password: ORG_MEMBER_PASSWORD,
    name: ORG_MEMBER_NAME,
    userType: 'PERSONAL',
    organizationId: ORG_ID,
    organizationName: ORG_NAME,
    extra: {
      age: 62,
      brainimalType: 'DOLPHIN_BRILLIANT',
      brainimalConfidence: 0.88,
      brainAge: 58,
      previousBrainAge: 61,
      streak: 5,
      bestStreak: 14,
      lastTrainingDate: new Date().toISOString(),
    },
  });

  // seedUser 는 신규 생성 시에만 extra 가 적용되고, 이후 시연 정합을 위해
  // 본 계정의 streak / lastTrainingDate 는 매번 강제 동기화한다.
  await withKeyLock(KV_LOCK.USERS, async () => {
    const member = await findUserByEmail(ORG_MEMBER_EMAIL);
    if (!member) return;
    await upsertUser({
      ...member,
      streak: 5,
      bestStreak: Math.max((member as any).bestStreak ?? 0, 14),
      lastTrainingDate: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  // 조직 memberUserIds 에 추가 — 운영 코드(approval 엔드포인트)와 동일하게 USERS 락으로 보호하여
  // organizations RMW 가 다른 cross-collection write 와 직렬화되도록 한다.
  await withKeyLock(KV_LOCK.USERS, async () => {
    const member = await findUserByEmail(ORG_MEMBER_EMAIL);
    if (!member) return;
    const org = await findOrganizationById(ORG_ID);
    if (!org) return;
    const memberIds: string[] = Array.isArray(org.memberUserIds) ? org.memberUserIds : [];
    if (memberIds.includes(member.id)) return;
    await upsertOrganization({
      ...org,
      memberUserIds: [...memberIds, member.id],
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ Personal org member linked to ${ORG_ID}: ${ORG_MEMBER_EMAIL}`);
  });
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
    const orgUsers = await listUsersByOrganization(ORG_ID, { includeDeleted: true });
    const byUsername = new Map(orgUsers.map((u) => [u.username, u]));
    let added = 0;
    for (const m of DEMO_ORG_MEMBERS) {
      const exists = byUsername.get(m.username);
      if (exists) {
        memberIds.push(exists.id);
        continue;
      }
      const now = Date.now();
      const lastTraining = new Date(now - m.daysAgoLastTraining * 24 * 60 * 60 * 1000).toISOString();
      const newUser: User = {
        id: `org_member_${m.username}_${now}_${Math.random().toString(36).substr(2, 4)}`,
        username: m.username,
        email: `${m.username}@demo-org.local`,
        name: m.name,
        // 데모 조직에 "소속된 개인 회원" 의도. 관리자 페이지에서 기업회원 탭에는
        // 조직을 운영하는 admin (org@org.com) 한 명만 노출되도록, 멤버들은
        // PERSONAL 로 시드한다 (이전에는 ORGANIZATION + APPROVED 로 들어가서
        // "기업회원 13명" 으로 잘못 보임 — 시드 정정 + 아래 마이그레이션으로 패치).
        userType: 'PERSONAL',
        organizationId: ORG_ID,
        organizationName: ORG_NAME,
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
      await upsertUser(newUser);
      memberIds.push(newUser.id);
      added += 1;
    }
    const admin = await findUserByEmail(ORG_EMAIL);
    if (admin) adminUserId = admin.id;
    if (added > 0) {
      console.log(`✅ Demo org members seeded: ${added}명 (organizationId=${ORG_ID})`);
    } else {
      console.log(`✅ Demo org members already present (organizationId=${ORG_ID})`);
    }
  });

  // 조직 레코드 동기화 — organizations RMW 는 USERS 락(운영 코드와 동일 컨벤션)으로 보호하여
  // 다른 cross-collection 변경(승인 등)과 직렬화한다. 기존 memberUserIds 는 보존(union).
  await withKeyLock(KV_LOCK.USERS, async () => {
    const seededIds = adminUserId ? [adminUserId, ...memberIds] : memberIds;
    const existing = await findOrganizationById(ORG_ID);
    const existingIds: string[] =
      existing && Array.isArray(existing.memberUserIds) ? existing.memberUserIds : [];
    const merged = Array.from(new Set([...existingIds, ...seededIds]));
    const orgRecord = {
      id: ORG_ID,
      name: ORG_NAME,
      memberUserIds: merged,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await upsertOrganization(
      existing ? { ...existing, ...orgRecord } : (orgRecord as any),
    );
  });
}

/**
 * 기업명 변경 시 organizations + 소속 users 의 organizationName 을 일괄 동기화.
 * - 멱등: 모두 이미 ORG_NAME 이면 no-op.
 * - cross-collection RMW 이므로 USERS 락으로 직렬화.
 */
async function renameDemoOrganization(): Promise<void> {
  await withKeyLock(KV_LOCK.USERS, async () => {
    let changed = false;

    const org = await findOrganizationById(ORG_ID);
    if (org && org.name !== ORG_NAME) {
      await upsertOrganization({
        ...org,
        name: ORG_NAME,
        updatedAt: new Date().toISOString(),
      });
      changed = true;
    }

    // organizationId 또는 pendingOrganizationId 가 ORG_ID 인 모든 사용자에서
    // organizationName / pendingOrganizationName 을 동기화.
    const allUsers = await listAllUsers({ includeDeleted: true });
    for (const u of allUsers) {
      let touched = false;
      const next: any = { ...u };
      if (u.organizationId === ORG_ID && u.organizationName !== ORG_NAME) {
        next.organizationName = ORG_NAME;
        next.updatedAt = new Date().toISOString();
        touched = true;
      }
      if ((u as any).pendingOrganizationId === ORG_ID && (u as any).pendingOrganizationName !== ORG_NAME) {
        next.pendingOrganizationName = ORG_NAME;
        touched = true;
      }
      if (touched) {
        await upsertUser(next);
        changed = true;
      }
    }

    if (changed) {
      console.log(`✅ Organization renamed → "${ORG_NAME}" (id=${ORG_ID})`);
    }
  });
}

/**
 * test@test.com 계정에 10일치 트레이닝 데이터 시드.
 *  - 합계 시간 = 정확히 4시간(= 24분 × 10세션, 240분)
 *  - 최근 5일 연속 + 그 이전 5회 비연속 → 14일 창 안에서 streak=5 유지
 *  - 마지막 세션 메트릭 = DEMO_METRICS(78/82/88/74/91/69)
 *  - sessions + metricsScores 동시 시드 → 변화 추이/랭킹/리포트 모두 자동 반영
 *  - 멱등: meta.seed='test-10d' 마커로 재시드 방지
 */
const TEST_USER_TRAINING: Array<{
  daysAgo: number;
  durationMin: number;
  score: number;
  metrics: { memory: number; comprehension: number; focus: number; judgment: number; agility: number; endurance: number };
}> = [
  { daysAgo: 13, durationMin: 24, score: 63, metrics: { memory: 60, comprehension: 64, focus: 68, judgment: 58, agility: 72, endurance: 55 } },
  { daysAgo: 12, durationMin: 24, score: 67, metrics: { memory: 63, comprehension: 67, focus: 72, judgment: 60, agility: 76, endurance: 57 } },
  { daysAgo: 11, durationMin: 24, score: 70, metrics: { memory: 66, comprehension: 70, focus: 75, judgment: 63, agility: 80, endurance: 60 } },
  { daysAgo: 10, durationMin: 24, score: 72, metrics: { memory: 68, comprehension: 72, focus: 78, judgment: 65, agility: 82, endurance: 61 } },
  { daysAgo:  7, durationMin: 24, score: 74, metrics: { memory: 70, comprehension: 74, focus: 80, judgment: 67, agility: 84, endurance: 63 } },
  { daysAgo:  4, durationMin: 24, score: 76, metrics: { memory: 72, comprehension: 76, focus: 82, judgment: 69, agility: 86, endurance: 64 } },
  { daysAgo:  3, durationMin: 24, score: 78, metrics: { memory: 74, comprehension: 78, focus: 84, judgment: 70, agility: 88, endurance: 66 } },
  { daysAgo:  2, durationMin: 24, score: 79, metrics: { memory: 75, comprehension: 79, focus: 85, judgment: 71, agility: 89, endurance: 67 } },
  { daysAgo:  1, durationMin: 24, score: 80, metrics: { memory: 77, comprehension: 81, focus: 87, judgment: 73, agility: 90, endurance: 68 } },
  { daysAgo:  0, durationMin: 24, score: 80, metrics: { memory: 78, comprehension: 82, focus: 88, judgment: 74, agility: 91, endurance: 69 } },
];

async function seedTestUserTrainings(): Promise<void> {
  await withKeyLock(KV_LOCK.USERS, async () => {
    const test = await findUserByEmail(TEST_EMAIL);
    if (!test) return;

    const seedMarker = 'test-10d-v1';
    const existing = await listSessions({ userId: test.id });
    const alreadySeeded = existing.some(
      (s: any) => s.meta?.seed === seedMarker,
    );
    if (alreadySeeded) {
      console.log('✅ test 사용자 10일치 트레이닝 시드 이미 존재');
      return;
    }

    const now = Date.now();
    let added = 0;
    for (const t of TEST_USER_TRAINING) {
      const createdAt = new Date(now - t.daysAgo * MS_DAY).toISOString();
      const id = `seed_test_${t.daysAgo}_${now}_${Math.random().toString(36).slice(2, 6)}`;
      const session: Session = {
        id,
        userId: test.id,
        mode: 'COMPOSITE',
        bpm: 92,
        level: 3,
        duration: t.durationMin * 60 * 1000,
        score: t.score,
        isComposite: true,
        isValid: true,
        phases: [],
        meta: { seed: seedMarker },
        createdAt,
      };
      await upsertSession(session);
      const metric: MetricsScore = {
        sessionId: id,
        userId: test.id,
        memory: t.metrics.memory,
        comprehension: t.metrics.comprehension,
        focus: t.metrics.focus,
        judgment: t.metrics.judgment,
        agility: t.metrics.agility,
        endurance: t.metrics.endurance,
        rhythm: t.score,
        createdAt,
      };
      await upsertMetricsScore(metric);
      added += 1;
    }

    // streak/lastTrainingDate/brainAge 등 사용자 필드 동기화
    const current = await findUserById(test.id);
    if (current) {
      await upsertUser({
        ...current,
        streak: 5,
        bestStreak: Math.max((current as any).bestStreak ?? 0, 5),
        lastTrainingDate: new Date(now).toISOString(),
        age: (current as any).age ?? 35,
        brainAge: (current as any).brainAge ?? 32,
        previousBrainAge: (current as any).previousBrainAge ?? 35,
        brainimalType: (current as any).brainimalType ?? 'FOX_BALANCED',
        brainimalConfidence: (current as any).brainimalConfidence ?? 0.86,
        updatedAt: new Date().toISOString(),
      });
    }

    console.log(`✅ test 사용자 ${added}건 트레이닝 시드 완료 (합계 ${added * 24}분 = 4시간)`);
  });
}

async function backfillMustChangeFlag(): Promise<void> {
  // users는 read-only이므로 락 불필요. passwords는 RMW이므로 PASSWORDS 락으로 보호.
  await withKeyLock(KV_LOCK.PASSWORDS, async () => {
    const targets = [ADMIN_EMAIL, TEST_EMAIL];
    for (const email of targets) {
      const u = await findUserByEmail(email);
      if (!u) continue;
      const p = await findPasswordByUserId(u.id);
      // KV 마이그레이션 전(레거시) password 레코드는 mustChange 가 명시 안 됐고
      // repo 가 false 로 normalize 하므로, 명시적으로 true 가 아니면 안전하게 true 보정.
      if (p && p.mustChange !== true) {
        await upsertPassword({
          ...p,
          mustChange: true,
          updatedAt: new Date().toISOString(),
        });
        console.log(`⚠️  [migration] mustChange=true 부여: ${email}`);
      }
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
      // 기존 KV 의 demo-org 멤버가 ORGANIZATION 으로 들어가 있으면 PERSONAL 로 패치
      // (관리자 페이지 "기업회원" 탭 분류 정정 — admin 한 명만 남도록).
      await migrateDemoOrgMembersToPersonal();
      await seedDemoOrgPersonalMember();
      await seedTestUserTrainings();
      // 기업명이 변경된 경우 기존 organization/users 레코드의 organizationName 도 동기화
      await renameDemoOrganization();
      // 기존에 시드된 기업 관리자에게 본인용 목업 데이터(브레이니멀/뇌나이/연속) 보강
      await patchUserMockData(ORG_EMAIL, ORG_ADMIN_MOCK);
    } else {
      console.log('ℹ️  [seed-admin] PRODUCTION: 테스트/기업 계정 시드는 건너뜁니다.');
    }
  } catch (error) {
    console.error('❌ Failed to seed accounts:', error);
    throw error;
  }
}
