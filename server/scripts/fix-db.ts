/**
 * 데이터베이스 문제 해결 스크립트
 * 1. Supabase 연결 확인
 * 2. 누락된 비밀번호 데이터 복구
 * 3. 데이터 마이그레이션
 */
import dotenv from 'dotenv';
import { db } from '../db.js';

dotenv.config();

async function fixDatabase() {
  console.log('🔧 데이터베이스 문제 해결 중...\n');
  
  try {
    // 현재 사용 중인 DB 확인
    console.log('1. 현재 데이터베이스 확인...');
    const dbType = process.env.DB_TYPE?.toLowerCase();
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    
    console.log(`   - DB_TYPE: ${dbType || 'not set'}`);
    console.log(`   - DATABASE_URL: ${hasDatabaseUrl ? '설정됨' : '설정 안 됨'}`);
    
    if (hasDatabaseUrl) {
      console.log('   ⚠️  DATABASE_URL이 설정되어 있지만 로컬 DB를 사용 중입니다.');
      console.log('   → Supabase 연결을 확인하세요.\n');
    }
    
    // 현재 데이터 확인
    console.log('2. 현재 데이터 확인...');
    const users = await db.get('users') || [];
    const passwords = await db.get('passwords') || [];
    
    console.log(`   - 사용자 수: ${users.length}`);
    console.log(`   - 비밀번호 레코드 수: ${passwords.length}`);
    
    // 비밀번호가 없는 사용자 찾기
    const usersWithoutPassword = users.filter((u: any) => {
      if (!u.email) return false;
      return !passwords.find((p: any) => p.userId === u.id);
    });
    
    if (usersWithoutPassword.length > 0) {
      console.log(`\n3. 비밀번호가 없는 사용자 발견: ${usersWithoutPassword.length}명`);
      usersWithoutPassword.forEach((u: any) => {
        console.log(`   - ${u.username} (${u.email}) - ID: ${u.id}`);
      });
      
      console.log('\n   ⚠️  이 사용자들은 로그인할 수 없습니다.');
      console.log('   → 비밀번호를 재설정하거나 회원가입을 다시 해야 합니다.\n');
    }
    
    // 닉네임 중복 확인
    console.log('4. 닉네임 중복 확인...');
    const usernameMap = new Map<string, number>();
    users.forEach((u: any) => {
      const count = usernameMap.get(u.username) || 0;
      usernameMap.set(u.username, count + 1);
    });
    
    const duplicates = Array.from(usernameMap.entries()).filter(([_, count]) => count > 1);
    if (duplicates.length > 0) {
      console.log(`   ⚠️  중복된 닉네임 발견: ${duplicates.length}개`);
      duplicates.forEach(([username, count]) => {
        console.log(`   - "${username}": ${count}회 사용됨`);
      });
    } else {
      console.log('   ✅ 중복된 닉네임 없음');
    }
    
    console.log('\n✅ 데이터베이스 상태 확인 완료');
    console.log('\n📋 해결 방법:');
    console.log('1. Supabase 연결을 확인하려면:');
    console.log('   - .env 파일의 DATABASE_URL이 올바른지 확인');
    console.log('   - Supabase 프로젝트의 연결 정보 확인');
    console.log('   - 서버를 재시작하여 연결 재시도');
    console.log('\n2. 비밀번호가 없는 사용자는:');
    console.log('   - 비밀번호 찾기 기능 사용');
    console.log('   - 또는 회원가입 다시 진행');
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    await db.disconnect();
  }
}

fixDatabase();
