/**
 * 환경 변수 확인 스크립트
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env 파일 로드
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('🔍 환경 변수 확인...\n');

console.log('1. DB_TYPE:', process.env.DB_TYPE || '(설정 안 됨)');
console.log('2. DATABASE_URL:', process.env.DATABASE_URL ? '설정됨' : '(설정 안 됨)');

if (process.env.DATABASE_URL) {
  const masked = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');
  console.log('   마스킹된 URL:', masked);
  
  // 호스트 추출
  const match = process.env.DATABASE_URL.match(/@([^:]+):/);
  if (match) {
    console.log('   호스트:', match[1]);
  }
}

console.log('3. REPLIT_DB_URL:', process.env.REPLIT_DB_URL || '(설정 안 됨)');
console.log('4. REPL_ID:', process.env.REPL_ID || '(설정 안 됨)');
console.log('5. NODE_ENV:', process.env.NODE_ENV || '(설정 안 됨)');

console.log('\n📋 예상되는 DB 선택:');
const dbType = process.env.DB_TYPE?.toLowerCase();
if (dbType === 'postgres' || dbType === 'postgresql' || dbType === 'neon' || dbType === 'supabase') {
  console.log('   → PostgreSQL (명시적 지정)');
} else if (process.env.DATABASE_URL) {
  console.log('   → PostgreSQL (DATABASE_URL 감지)');
} else if (process.env.REPLIT_DB_URL || process.env.REPL_ID) {
  console.log('   → Replit Database');
} else {
  console.log('   → 로컬 JSON 파일');
}
