/**
 * 모든 연결 방법 테스트
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

async function testAllMethods() {
  console.log('🔍 모든 연결 방법 테스트...\n');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL이 설정되지 않았습니다.');
    process.exit(1);
  }
  
  console.log('📋 현재 DATABASE_URL:');
  const masked = dbUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`   ${masked}\n`);
  
  // URL 파싱
  const urlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!urlMatch) {
    console.error('❌ DATABASE_URL 형식이 올바르지 않습니다.');
    process.exit(1);
  }
  
  const [, user, password, host, port, database] = urlMatch;
  
  console.log('📋 파싱된 정보:');
  console.log(`   호스트: ${host}`);
  console.log(`   포트: ${port}`);
  console.log(`   데이터베이스: ${database}`);
  console.log(`   사용자: ${user}\n`);
  
  // DNS 조회 테스트
  console.log('🌐 DNS 조회 테스트...');
  const dns = await import('dns');
  const { lookup } = dns.promises;
  
  try {
    const addresses = await lookup(host, { all: true });
    console.log(`   ✅ DNS 조회 성공 (${addresses.length}개 주소 발견):`);
    addresses.forEach((addr, idx) => {
      console.log(`      ${idx + 1}. ${addr.address} (IPv${addr.family === 4 ? '4' : '6'})`);
    });
  } catch (error) {
    console.error(`   ❌ DNS 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error('\n💡 이 호스트 주소는 존재하지 않거나 접근할 수 없습니다.');
    console.error('   Supabase 대시보드에서 올바른 Connection String을 확인하세요.');
    process.exit(1);
  }
  
  // 연결 테스트
  console.log('\n🔄 PostgreSQL 연결 테스트...');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 15000,
  });
  
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout (15초)')), 15000)
      )
    ]) as any;
    
    console.log('   ✅ 연결 성공!\n');
    
    // 버전 확인
    const versionResult = await client.query('SELECT version()');
    console.log('📊 PostgreSQL 정보:');
    console.log(`   버전: ${versionResult.rows[0].version.split(' ')[0]} ${versionResult.rows[0].version.split(' ')[1]}`);
    
    // 테이블 확인
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log(`\n📋 테이블 목록 (${tables.rows.length}개):`);
    if (tables.rows.length === 0) {
      console.log('   (테이블 없음 - 정상, 자동 생성됨)');
    } else {
      tables.rows.forEach((t: any) => {
        console.log(`   - ${t.table_name}`);
      });
    }
    
    // kv_store 테이블 생성
    const kvStoreExists = tables.rows.some((t: any) => t.table_name === 'kv_store');
    if (!kvStoreExists) {
      console.log('\n🔧 kv_store 테이블 생성 중...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key VARCHAR(255) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_kv_key ON kv_store(key)
      `);
      console.log('   ✅ kv_store 테이블 생성 완료');
    } else {
      console.log('\n   ✅ kv_store 테이블 이미 존재');
    }
    
    // 데이터 저장/조회 테스트
    console.log('\n🧪 데이터 저장/조회 테스트...');
    const testKey = 'connection_test_' + Date.now();
    const testData = { test: true, timestamp: new Date().toISOString() };
    
    await client.query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) 
       DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
      [testKey, JSON.stringify(testData)]
    );
    console.log('   ✅ 데이터 저장 성공');
    
    const retrieveResult = await client.query(
      'SELECT value FROM kv_store WHERE key = $1',
      [testKey]
    );
    const retrieved = retrieveResult.rows[0]?.value;
    console.log('   ✅ 데이터 조회 성공:', JSON.stringify(retrieved));
    
    await client.query('DELETE FROM kv_store WHERE key = $1', [testKey]);
    console.log('   ✅ 데이터 삭제 성공');
    
    client.release();
    await pool.end();
    
    console.log('\n✅ 모든 테스트 통과! Supabase 연결이 정상적으로 작동합니다.');
    console.log('\n💡 다음 단계:');
    console.log('   1. 서버를 재시작하세요: cd server && npm run dev');
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
    await pool.end();
    process.exit(1);
  }
}

testAllMethods();
