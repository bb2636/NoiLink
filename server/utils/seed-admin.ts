import { db } from '../db.js';
import { hashPassword } from './password.js';
import type { User } from '@noilink/shared';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

export async function seedAdminAccount(): Promise<void> {
  try {
    const users = await db.get('users') || [];
    
    const existingAdmin = users.find((u: any) => 
      u.email === ADMIN_EMAIL || 
      (u.username === ADMIN_USERNAME && u.userType === 'ADMIN')
    );
    
    if (existingAdmin) {
      console.log('✅ Admin account already exists');
      return;
    }

    if (!ADMIN_PASSWORD) {
      console.log('⏭️  Skipping admin seed (no ADMIN_PASSWORD configured)');
      return;
    }
    
    const adminUser: User = {
      id: `admin_${Date.now()}`,
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      name: '관리자',
      userType: 'ADMIN',
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
    
    users.push(adminUser);
    await db.set('users', users);
    
    const hashed = await hashPassword(ADMIN_PASSWORD);
    const passwords = await db.get('passwords') || [];
    passwords.push({
      userId: adminUser.id,
      email: ADMIN_EMAIL,
      password: hashed,
      createdAt: new Date().toISOString(),
    });
    await db.set('passwords', passwords);
    
    console.log('✅ Admin account created:', ADMIN_EMAIL);
  } catch (error) {
    console.error('❌ Failed to seed admin account:', error);
    throw error;
  }
}
