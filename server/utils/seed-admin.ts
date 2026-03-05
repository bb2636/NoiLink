/**
 * 관리자 시드 계정 생성
 */
import { db } from '../db.js';
import type { User } from '@noilink/shared';

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin1234'; // 실제 운영 시 해시화 필요

export async function seedAdminAccount(): Promise<void> {
  try {
    const users = await db.get('users') || [];
    
    // 이미 관리자 계정이 있는지 확인
    const existingAdmin = users.find((u: any) => 
      u.email === ADMIN_EMAIL || 
      (u.username === ADMIN_USERNAME && u.userType === 'ADMIN')
    );
    
    if (existingAdmin) {
      console.log('✅ Admin account already exists');
      return;
    }
    
    // 관리자 계정 생성
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
    
    // 비밀번호 저장 (실제 운영 시 해시화 필요)
    const passwords = await db.get('passwords') || [];
    passwords.push({
      userId: adminUser.id,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD, // 실제 운영 시 bcrypt 등으로 해시화
      createdAt: new Date().toISOString(),
    });
    await db.set('passwords', passwords);
    
    console.log('✅ Admin account created:', ADMIN_EMAIL);
  } catch (error) {
    console.error('❌ Failed to seed admin account:', error);
    throw error;
  }
}
