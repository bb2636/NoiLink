/**
 * Connection Pooling URL 테스트
 * Supabase는 Connection Pooling을 권장합니다
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

async function testWithPooling() {
  console.log('🔍 Connection Pooling 테스트...\n');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL이 설정되지 않았습니다.');
    process.exit(1);
  }
  
  // Direct connection URL에서 Pooling URL 생성 시도
  const directMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co:5432\/(.+)/);
  
  if (directMatch) {
    const [, user, password, projectRef, database] = directMatch;
    
    console.log('📋 Direct Connection URL 발견:');
    console.log(`   프로젝트 ID: ${projectRef}`);
    console.log(`   데이터베이스: ${database}\n`);
    
    // Connection Pooling URL 생성 (포트 6543 사용)
    const poolingUrl = `postgresql://${user}:${password}@pooler.supabase.com:6543/${database}?pgbouncer=true`;
    const poolingUrlWithProject = `postgresql://${user}:${password}@aws-0-${projectRef}.pooler.supabase.com:6543/${database}?pgbouncer=true`;
    
    console.log('🔄 Connection Pooling URL로 연결 시도...\n');
    
    const urlsToTest = [
      { name: '표준 Pooling URL', url: poolingUrl },
      { name: '프로젝트별 Pooling URL', url: poolingUrlWithProject },
      { name: '원본 Direct URL', url: dbUrl },
    ];
    
    for (const { name, url } of urlsToTest) {
      console.log(`📡 ${name} 시도 중...`);
      const masked = url.replace(/:[^:@]+@/, ':****@');
      console.log(`   ${masked}\n`);
      
      const pool = new Pool({
        connectionString: url,
        ssl: {
          rejectUnauthorized: false,
        },
        connectionTimeoutMillis: 15000,
      });
      
      try {
        const client = await Promise.race([
          pool.connect(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), 15000)
          )
        ]) as any;
        
        console.log(`   ✅ ${name} 연결 성공!\n`);
        
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
        if (tables.rows.length > 0) {
          tables.rows.slice(0, 10).forEach((t: any) => {
            console.log(`   - ${t.table_name}`);
          });
          if (tables.rows.length > 10) {
            console.log(`   ... 외 ${tables.rows.length - 10}개`);
          }
        } else {
          console.log('   (테이블 없음 - 정상, 자동 생성됨)');
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
        }
        
        // 데이터 테스트
        console.log('\n🧪 데이터 저장/조회 테스트...');
        const testKey = 'test_' + Date.now();
        await client.query(
          `INSERT INTO kv_store (key, value) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
          [testKey, JSON.stringify({ test: true })]
        );
        const result = await client.query('SELECT value FROM kv_store WHERE key = $1', [testKey]);
        console.log('   ✅ 데이터 저장/조회 성공');
        await client.query('DELETE FROM kv_store WHERE key = $1', [testKey]);
        console.log('   ✅ 데이터 삭제 성공');
        
        client.release();
        await pool.end();
        
        console.log(`\n✅ ${name}로 모든 테스트 통과!`);
        console.log(`\n💡 권장: .env 파일의 DATABASE_URL을 다음으로 업데이트하세요:`);
        console.log(`   ${url.replace(/:[^:@]+@/, ':****@')}`);
        
        process.exit(0);
        
      } catch (error) {
        console.error(`   ❌ ${name} 실패`);
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
  } else {
    console.error('❌ DATABASE_URL 형식을 파싱할 수 없습니다.');
    console.error('   예상 형식: postgresql://user:password@db.xxx.supabase.co:5432/database');
  }
  
  process.exit(1);
}

testWithPooling();
