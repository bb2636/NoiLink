/**
 * Supabase 연결 상태로 서버 시작 테스트
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 환경 변수 로드
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

async function testServerStart() {
  console.log('🚀 서버 시작 테스트 (Supabase 연결)...\n');
  
  console.log('📋 환경 변수:');
  console.log(`   DB_TYPE: ${process.env.DB_TYPE || '(설정 안 됨)'}`);
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '설정됨' : '(설정 안 됨)'}`);
  if (process.env.DATABASE_URL) {
    const masked = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`   마스킹된 URL: ${masked}`);
  }
  console.log('');
  
  try {
    console.log('🔄 데이터베이스 연결 시도...');
    await db.connect();
    
    console.log('✅ 데이터베이스 연결 성공!\n');
    
    // 연결 타입 확인
    const isConnected = db.isConnected();
    console.log(`📊 연결 상태: ${isConnected ? '✅ 연결됨' : '❌ 연결 안 됨'}`);
    
    // 테스트 데이터 저장/조회
    console.log('\n🧪 데이터 저장/조회 테스트...');
    const testKey = 'server_test_' + Date.now();
    const testData = { message: 'Server test', timestamp: new Date().toISOString() };
    
    await db.set(testKey, testData);
    console.log('   ✅ 데이터 저장 성공');
    
    const retrieved = await db.get(testKey);
    console.log('   ✅ 데이터 조회 성공:', JSON.stringify(retrieved));
    
    await db.delete(testKey);
    console.log('   ✅ 데이터 삭제 성공');
    
    // users 데이터 확인
    console.log('\n📊 기존 데이터 확인...');
    const users = await db.get('users') || [];
    console.log(`   - 사용자 수: ${users.length}`);
    
    if (users.length > 0) {
      console.log('   - 사용자 목록:');
      users.slice(0, 3).forEach((u: any) => {
        console.log(`     • ${u.username} (${u.email || '이메일 없음'})`);
      });
    }
    
    console.log('\n✅ 모든 테스트 통과! 서버가 Supabase에 정상적으로 연결되었습니다.');
    console.log('\n💡 다음 단계:');
    console.log('   1. 서버를 재시작하세요: npm run dev');
    console.log('   2. 서버 로그에서 "✅ Connected to PostgreSQL" 메시지 확인');
    console.log('   3. 회원가입/로그인 테스트');
    
  } catch (error) {
    console.error('\n❌ 연결 실패:', error);
    if (error instanceof Error) {
      console.error('   오류 메시지:', error.message);
      if ((error as any).code) {
        console.error('   오류 코드:', (error as any).code);
      }
    }
    
    console.error('\n💡 해결 방법:');
    console.error('   1. Supabase 프로젝트가 활성화되어 있는지 확인');
    console.error('   2. .env 파일의 DATABASE_URL이 올바른지 확인');
    console.error('   3. 서버를 재시작하여 새로운 환경 변수 로드');
    console.error('   4. 또는 로컬 JSON DB로 계속 개발 (현재 작동 중)');
    
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

testServerStart();
