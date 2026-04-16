import { db } from '../db.js';
import { hashPassword } from './password.js';
import type { User } from '@noilink/shared';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

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
    await seedUser({
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      name: '관리자',
      userType: 'ADMIN',
    });

    await seedUser({
      email: TEST_EMAIL,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      name: '테스트 사용자',
      userType: 'PERSONAL',
    });
  } catch (error) {
    console.error('❌ Failed to seed accounts:', error);
    throw error;
  }
}
