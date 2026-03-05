/**
 * 직접 PostgreSQL 연결 테스트 (pg 라이브러리 사용)
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

async function testDirectConnection() {
  console.log('🔍 직접 PostgreSQL 연결 테스트...\n');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL이 설정되지 않았습니다.');
    process.exit(1);
  }
  
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`📡 연결 시도: ${maskedUrl}\n`);
  
  // URL 파싱
  const urlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!urlMatch) {
    console.error('❌ DATABASE_URL 형식이 올바르지 않습니다.');
    process.exit(1);
  }
  
  const [, user, password, host, port, database] = urlMatch;
  
  console.log('📋 연결 정보:');
  console.log(`   호스트: ${host}`);
  console.log(`   포트: ${port}`);
  console.log(`   데이터베이스: ${database}`);
  console.log(`   사용자: ${user}\n`);
  
  // Pool 옵션으로 직접 연결 시도
  const pool = new Pool({
    host,
    port: parseInt(port),
    database,
    user,
    password,
    ssl: {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 10000,
  });
  
  try {
    console.log('🔄 연결 중...');
    const client = await pool.connect();
    console.log('✅ 연결 성공!\n');
    
    // 간단한 쿼리 테스트
    console.log('🧪 쿼리 테스트...');
    const result = await client.query('SELECT version()');
    console.log('   ✅ PostgreSQL 버전:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
    
    // 테이블 확인
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log(`\n📊 테이블 목록 (${tables.rows.length}개):`);
    if (tables.rows.length === 0) {
      console.log('   (테이블 없음 - 정상, 자동 생성됨)');
    } else {
      tables.rows.forEach((t: any) => {
        console.log(`   - ${t.table_name}`);
      });
    }
    
    client.release();
    await pool.end();
    
    console.log('\n✅ 모든 테스트 통과! Supabase 연결이 정상적으로 작동합니다.');
    
  } catch (error) {
    console.error('\n❌ 연결 실패:', error);
    if (error instanceof Error) {
      console.error('\n오류 상세:');
      console.error('   메시지:', error.message);
      console.error('   코드:', (error as any).code);
      
      if ((error as any).code === 'ENOTFOUND') {
        console.error('\n💡 DNS 조회 실패:');
        console.error('   1. Supabase 프로젝트가 삭제되었거나 비활성화되었을 수 있습니다');
        console.error('   2. 호스트 주소가 잘못되었을 수 있습니다');
        console.error('   3. Supabase 대시보드에서 새로운 Connection String을 확인하세요');
      } else if ((error as any).code === 'ETIMEDOUT' || (error as any).code === 'ECONNREFUSED') {
        console.error('\n💡 연결 시간 초과 또는 거부:');
        console.error('   1. 방화벽 설정 확인');
        console.error('   2. 네트워크 연결 확인');
        console.error('   3. Supabase 프로젝트 상태 확인');
      } else if (error.message.includes('password')) {
        console.error('\n💡 인증 실패:');
        console.error('   1. 비밀번호가 올바른지 확인');
        console.error('   2. 특수문자가 있으면 URL 인코딩 필요');
      }
    }
    await pool.end();
    process.exit(1);
  }
}

testDirectConnection();
