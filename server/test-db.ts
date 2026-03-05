/**
 * 데이터베이스 연결 테스트 스크립트
 * 
 * 사용법:
 *   tsx server/test-db.ts
 */

import { db } from './db.js';

async function testDB() {
  console.log('🧪 데이터베이스 연결 테스트 시작...\n');
  
  try {
    // 1. 테스트 데이터 저장
    console.log('1️⃣  테스트 데이터 저장 중...');
    await db.set('test_key', {
      message: 'Hello Database!',
      timestamp: new Date().toISOString(),
      number: 42,
    });
    console.log('   ✅ 저장 완료\n');
    
    // 2. 테스트 데이터 조회
    console.log('2️⃣  테스트 데이터 조회 중...');
    const data = await db.get('test_key');
    console.log('   ✅ 조회 완료:', data);
    console.log('');
    
    // 3. 배열 데이터 테스트
    console.log('3️⃣  배열 데이터 테스트 중...');
    await db.set('test_array', [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ]);
    const arrayData = await db.get('test_array');
    console.log('   ✅ 배열 데이터:', arrayData);
    console.log('');
    
    // 4. 키 목록 조회
    console.log('4️⃣  키 목록 조회 중...');
    const keys = await db.list();
    const testKeys = keys.filter((k: string) => k.startsWith('test_'));
    console.log('   ✅ 테스트 키 목록:', testKeys);
    console.log('');
    
    // 5. 데이터 삭제
    console.log('5️⃣  테스트 데이터 삭제 중...');
    await db.delete('test_key');
    await db.delete('test_array');
    console.log('   ✅ 삭제 완료\n');
    
    // 6. 삭제 확인
    const deletedData = await db.get('test_key');
    if (deletedData === undefined || deletedData === null) {
      console.log('   ✅ 삭제 확인됨\n');
    } else {
      console.log('   ⚠️  삭제되지 않음:', deletedData);
    }
    
    console.log('✅ 모든 테스트 통과! 데이터베이스가 정상적으로 작동합니다.');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    if (error instanceof Error) {
      console.error('   에러 메시지:', error.message);
      console.error('   스택:', error.stack);
    }
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
testDB();
