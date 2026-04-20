import { db } from '../db.js';
import { hashPassword } from './password.js';
import type { User } from '@noilink/shared';

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

async function seedUser(opts: {
  email: string;
  username: string;
  password: string;
  name: string;
  userType: 'ADMIN' | 'PERSONAL' | 'ORGANIZATION';
}): Promise<void> {
  const users = await db.get('users') || [];

  const exists = users.find((u: any) =>
    u.email === opts.email ||
    (u.username === opts.username && u.userType === opts.userType)
  );

  if (exists) {
    console.log(`✅ ${opts.userType} account already exists: ${opts.email}`);
    return;
  }

  const newUser: User = {
    id: `${opts.userType.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    username: opts.username,
    email: opts.email,
    name: opts.name,
    userType: opts.userType,
    organizationId: undefined,
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

  users.push(newUser);
  await db.set('users', users);

  const hashed = await hashPassword(opts.password);
  const passwords = await db.get('passwords') || [];
  passwords.push({
    userId: newUser.id,
    email: opts.email,
    password: hashed,
    createdAt: new Date().toISOString(),
  });
  await db.set('passwords', passwords);

  console.log(`✅ ${opts.userType} account created: ${opts.email}`);
}

export async function seedAdminAccount(): Promise<void> {
  try {
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
    } else {
      console.log('ℹ️  [seed-admin] PRODUCTION: 테스트 계정 시드는 건너뜁니다.');
    }
  } catch (error) {
    console.error('❌ Failed to seed accounts:', error);
    throw error;
  }
}
