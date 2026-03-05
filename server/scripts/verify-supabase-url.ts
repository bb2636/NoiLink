/**
 * Supabase URL 검증 스크립트
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dns from 'dns';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const lookup = promisify(dns.lookup);

async function verifySupabaseUrl() {
  console.log('🔍 Supabase URL 검증 중...\n');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL이 설정되지 않았습니다.');
    process.exit(1);
  }
  
  // URL 파싱
  const urlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!urlMatch) {
    console.error('❌ DATABASE_URL 형식이 올바르지 않습니다.');
    console.log('예상 형식: postgresql://user:password@host:port/database');
    process.exit(1);
  }
  
  const [, user, password, host, port, database] = urlMatch;
  const maskedUrl = `postgresql://${user}:****@${host}:${port}/${database}`;
  
  console.log('📋 연결 정보:');
  console.log(`   사용자: ${user}`);
  console.log(`   호스트: ${host}`);
  console.log(`   포트: ${port}`);
  console.log(`   데이터베이스: ${database}`);
  console.log(`   전체 URL: ${maskedUrl}\n`);
  
  // DNS 조회 테스트
  console.log('🌐 DNS 조회 테스트...');
  try {
    const addresses = await lookup(host);
    console.log(`   ✅ DNS 조회 성공: ${addresses.address}`);
    if (addresses.family === 4) {
      console.log(`   → IPv4 주소: ${addresses.address}`);
    } else {
      console.log(`   → IPv6 주소: ${addresses.address}`);
    }
  } catch (error) {
    console.error(`   ❌ DNS 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error('\n💡 가능한 원인:');
    console.error('   1. Supabase 프로젝트가 삭제되었거나 비활성화됨');
    console.error('   2. 호스트 주소가 잘못됨');
    console.error('   3. 네트워크 연결 문제');
    console.error('\n📝 해결 방법:');
    console.error('   1. Supabase 대시보드에서 프로젝트 상태 확인');
    console.error('   2. Settings > Database > Connection String 확인');
    console.error('   3. 새로운 프로젝트를 생성했다면 새로운 Connection String 사용');
    process.exit(1);
  }
  
  console.log('\n✅ 호스트 주소는 유효합니다.');
  console.log('   → 다음 단계: PostgreSQL 연결 테스트를 진행하세요.');
}

verifySupabaseUrl();
