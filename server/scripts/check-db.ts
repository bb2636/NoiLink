/**
 * 데이터베이스 상태 확인 스크립트
 */
import dotenv from 'dotenv';
import { db } from '../db.js';

dotenv.config();

async function checkDatabase() {
  console.log('🔍 데이터베이스 상태 확인 중...\n');
  
  try {
    // 1. 연결 확인
    console.log('1. 데이터베이스 연결 확인...');
    await db.connect();
    console.log('✅ 연결 성공\n');
    
    // 2. users 데이터 확인
    console.log('2. users 데이터 확인...');
    const users = await db.get('users') || [];
    console.log(`   - 총 사용자 수: ${users.length}`);
    if (users.length > 0) {
      console.log('   - 사용자 목록:');
      users.slice(0, 5).forEach((u: any) => {
        console.log(`     • ${u.username} (${u.email || '이메일 없음'}) - ID: ${u.id}`);
      });
      if (users.length > 5) {
        console.log(`     ... 외 ${users.length - 5}명`);
      }
    } else {
      console.log('   ⚠️  사용자 데이터가 없습니다.');
    }
    console.log('');
    
    // 3. passwords 데이터 확인
    console.log('3. passwords 데이터 확인...');
    const passwords = await db.get('passwords') || [];
    console.log(`   - 총 비밀번호 레코드 수: ${passwords.length}`);
    if (passwords.length > 0) {
      console.log('   - 비밀번호 레코드:');
      passwords.slice(0, 3).forEach((p: any) => {
        console.log(`     • UserID: ${p.userId}, Email: ${p.email}`);
      });
    } else {
      console.log('   ⚠️  비밀번호 데이터가 없습니다.');
    }
    console.log('');
    
    // 4. 테스트: 데이터 저장/조회
    console.log('4. 데이터 저장/조회 테스트...');
    const testKey = 'test_' + Date.now();
    await db.set(testKey, { test: 'value', timestamp: new Date().toISOString() });
    const testValue = await db.get(testKey);
    console.log(`   ✅ 저장/조회 성공: ${JSON.stringify(testValue)}`);
    await db.delete(testKey);
    console.log('   ✅ 삭제 성공\n');
    
    // 5. PostgreSQL인 경우 테이블 확인
    if (process.env.DATABASE_URL) {
      console.log('5. PostgreSQL 테이블 확인...');
      try {
        const tables = await db.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
        `);
        console.log(`   - 테이블 목록:`);
        tables.forEach((t: any) => {
          console.log(`     • ${t.table_name}`);
        });
        
        // kv_store 테이블 상세 확인
        const kvStoreCheck = await db.query(`
          SELECT COUNT(*) as count 
          FROM kv_store
        `);
        console.log(`   - kv_store 레코드 수: ${kvStoreCheck[0].count}`);
      } catch (error) {
        console.log(`   ⚠️  테이블 확인 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      console.log('');
    }
    
    console.log('✅ 데이터베이스 상태 확인 완료');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    if (error instanceof Error) {
      console.error('   메시지:', error.message);
      console.error('   스택:', error.stack);
    }
  } finally {
    await db.disconnect();
  }
}

checkDatabase();
