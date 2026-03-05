/**
 * Supabase Connection Pooling 연결 테스트
 * Supabase는 Connection Pooling을 사용하는 것이 권장됩니다
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

async function testConnectionPooling() {
  console.log('🔍 Supabase Connection Pooling 테스트...\n');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL이 설정되지 않았습니다.');
    process.exit(1);
  }
  
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`📡 연결 시도: ${maskedUrl}\n`);
  
  // Connection Pooling URL 형식 확인
  // Supabase는 보통 pooler.supabase.com 또는 직접 연결 db.xxx.supabase.co 사용
  const isPooling = dbUrl.includes('pooler.supabase.com') || dbUrl.includes('/pooler');
  const isDirect = dbUrl.includes('db.') && dbUrl.includes('.supabase.co');
  
  console.log('📋 연결 타입:');
  console.log(`   - Connection Pooling: ${isPooling ? '✅' : '❌'}`);
  console.log(`   - Direct Connection: ${isDirect ? '✅' : '❌'}\n`);
  
  if (!isPooling && !isDirect) {
    console.log('⚠️  Supabase 형식이 아닌 것 같습니다.');
    console.log('   일반 형식: postgresql://postgres:password@db.xxx.supabase.co:5432/postgres');
    console.log('   Pooling 형식: postgresql://postgres:password@pooler.supabase.com:6543/postgres?pgbouncer=true\n');
  }
  
  // URL 파싱
  let host, port, database, user, password;
  
  try {
    const urlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
    if (urlMatch) {
      [, user, password, host, port, database] = urlMatch;
    } else {
      // 다른 형식 시도
      const url = new URL(dbUrl.replace('postgresql://', 'http://'));
      host = url.hostname;
      port = url.port || '5432';
      database = url.pathname.slice(1).split('?')[0] || 'postgres';
      user = url.username || 'postgres';
      password = url.password || '';
    }
  } catch (error) {
    console.error('❌ URL 파싱 실패:', error);
    process.exit(1);
  }
  
  console.log('📋 연결 정보:');
  console.log(`   호스트: ${host}`);
  console.log(`   포트: ${port}`);
  console.log(`   데이터베이스: ${database}`);
  console.log(`   사용자: ${user}\n`);
  
  // 여러 방법으로 연결 시도
  const methods = [
    {
      name: 'Connection String 방식',
      config: { connectionString: dbUrl, ssl: { rejectUnauthorized: false } }
    },
    {
      name: '개별 파라미터 방식',
      config: {
        host,
        port: parseInt(port),
        database,
        user,
        password,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      }
    }
  ];
  
  for (const method of methods) {
    console.log(`🔄 ${method.name} 시도 중...`);
    const pool = new Pool(method.config);
    
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 10000)
        )
      ]) as any;
      
      console.log(`   ✅ ${method.name} 성공!\n`);
      
      // 쿼리 테스트
      const result = await client.query('SELECT version()');
      console.log('   📊 PostgreSQL 버전:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
      
      // 테이블 확인
      const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      
      console.log(`   📋 테이블 수: ${tables.rows.length}`);
      if (tables.rows.length > 0 && tables.rows.length <= 10) {
        tables.rows.forEach((t: any) => {
          console.log(`      - ${t.table_name}`);
        });
      }
      
      // kv_store 테이블 확인/생성
      const kvStoreExists = tables.rows.some((t: any) => t.table_name === 'kv_store');
      if (!kvStoreExists) {
        console.log('\n   🔧 kv_store 테이블 생성 중...');
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
        console.log('   ✅ kv_store 테이블 존재 확인');
      }
      
      // 데이터 저장/조회 테스트
      console.log('\n   🧪 데이터 저장/조회 테스트...');
      const testKey = 'connection_test_' + Date.now();
      const testData = { test: true, timestamp: new Date().toISOString() };
      
      await client.query(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key) 
         DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
        [testKey, JSON.stringify(testData)]
      );
      console.log('      ✅ 데이터 저장 성공');
      
      const retrieveResult = await client.query(
        'SELECT value FROM kv_store WHERE key = $1',
        [testKey]
      );
      const retrieved = retrieveResult.rows[0]?.value;
      console.log('      ✅ 데이터 조회 성공:', JSON.stringify(retrieved));
      
      await client.query('DELETE FROM kv_store WHERE key = $1', [testKey]);
      console.log('      ✅ 데이터 삭제 성공');
      
      client.release();
      await pool.end();
      
      console.log(`\n✅ ${method.name}로 모든 테스트 통과!`);
      console.log('   → Supabase 연결이 정상적으로 작동합니다.\n');
      process.exit(0);
      
    } catch (error) {
      console.error(`   ❌ ${method.name} 실패`);
      if (error instanceof Error) {
        console.error(`      오류: ${error.message}`);
        if ((error as any).code) {
          console.error(`      코드: ${(error as any).code}`);
        }
      }
      await pool.end();
      console.log('');
    }
  }
  
  console.error('❌ 모든 연결 방법 실패');
  console.error('\n💡 해결 방법:');
  console.error('   1. Supabase 대시보드에서 프로젝트 상태 확인');
  console.error('   2. Settings > Database > Connection String 확인');
  console.error('   3. Connection Pooling URL 사용 시도 (pooler.supabase.com)');
  console.error('   4. Direct Connection URL 사용 시도 (db.xxx.supabase.co)');
  process.exit(1);
}

testConnectionPooling();
