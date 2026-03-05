/**
 * Supabase 연결 테스트 스크립트
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PostgresDB } from '../db/postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env 파일 경로 찾기 (server/.env 또는 루트/.env)
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

async function testConnection() {
  console.log('🔍 Supabase 연결 테스트...\n');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL 환경 변수가 설정되지 않았습니다.');
    console.log('\n.env 파일에 다음을 추가하세요:');
    console.log('DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres');
    process.exit(1);
  }
  
  // 비밀번호 마스킹
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`📡 연결 시도: ${maskedUrl}\n`);
  
  try {
    const db = new PostgresDB();
    await db.connect();
    
    console.log('✅ Supabase 연결 성공!\n');
    
    // 테이블 확인
    console.log('📊 테이블 확인 중...');
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    if (tables.length === 0) {
      console.log('   ⚠️  테이블이 없습니다. (정상 - 자동 생성됨)');
    } else {
      console.log(`   ✅ 테이블 ${tables.length}개 발견:`);
      tables.forEach((t: any) => {
        console.log(`      - ${t.table_name}`);
      });
    }
    
    // kv_store 테이블 확인
    const kvStoreExists = tables.some((t: any) => t.table_name === 'kv_store');
    if (!kvStoreExists) {
      console.log('\n   ⚠️  kv_store 테이블이 없습니다. 초기화 중...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key VARCHAR(255) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_kv_key ON kv_store(key)
      `);
      console.log('   ✅ kv_store 테이블 생성 완료');
    }
    
    // 데이터 테스트
    console.log('\n🧪 데이터 저장/조회 테스트...');
    const testKey = 'connection_test_' + Date.now();
    const testData = { test: true, timestamp: new Date().toISOString() };
    
    await db.set(testKey, testData);
    console.log('   ✅ 데이터 저장 성공');
    
    const retrieved = await db.get(testKey);
    console.log('   ✅ 데이터 조회 성공:', JSON.stringify(retrieved));
    
    await db.delete(testKey);
    console.log('   ✅ 데이터 삭제 성공');
    
    console.log('\n✅ 모든 테스트 통과! Supabase가 정상적으로 작동합니다.');
    
  } catch (error) {
    console.error('\n❌ 연결 실패:', error);
    if (error instanceof Error) {
      console.error('\n오류 상세:');
      console.error('   메시지:', error.message);
      
      if (error.message.includes('password authentication failed')) {
        console.error('\n💡 해결 방법:');
        console.error('   1. Supabase 대시보드에서 비밀번호 확인');
        console.error('   2. DATABASE_URL의 비밀번호가 올바른지 확인');
        console.error('   3. 비밀번호에 특수문자가 있으면 URL 인코딩 필요');
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        console.error('\n💡 해결 방법:');
        console.error('   1. DATABASE_URL의 호스트 주소 확인');
        console.error('   2. 인터넷 연결 확인');
        console.error('   3. Supabase 프로젝트가 활성화되어 있는지 확인');
      } else if (error.message.includes('timeout')) {
        console.error('\n💡 해결 방법:');
        console.error('   1. 네트워크 연결 확인');
        console.error('   2. 방화벽 설정 확인');
        console.error('   3. Supabase 프로젝트 상태 확인');
      }
    }
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testConnection();
