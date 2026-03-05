/**
 * 데이터베이스 마이그레이션 유틸리티
 * 스키마 변경 시 기존 데이터를 마이그레이션하는 도구
 */

import { db } from '../db.js';

/**
 * 마이그레이션 버전 관리
 */
interface MigrationVersion {
  version: string;
  appliedAt: string;
}

/**
 * 마이그레이션 함수 타입
 */
type MigrationFunction = () => Promise<void>;

/**
 * 마이그레이션 기록
 */
interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: string;
}

/**
 * 마이그레이션 실행
 */
export async function runMigrations(): Promise<void> {
  try {
    const migrations = await db.get('migrations') as MigrationRecord[] || [];
    const appliedVersions = new Set(migrations.map(m => m.version));

    // 마이그레이션 목록 (버전 순서대로)
    const migrationList: Array<{ version: string; name: string; fn: MigrationFunction }> = [
      {
        version: '1.0.0',
        name: 'Initial schema migration',
        fn: migration_1_0_0,
      },
      // 향후 마이그레이션 추가
    ];

    for (const migration of migrationList) {
      if (appliedVersions.has(migration.version)) {
        console.log(`⏭️  Migration ${migration.version} (${migration.name}) already applied.`);
        continue;
      }

      console.log(`🔄 Running migration ${migration.version} (${migration.name})...`);
      await migration.fn();

      // 마이그레이션 기록 저장
      const newRecord: MigrationRecord = {
        version: migration.version,
        name: migration.name,
        appliedAt: new Date().toISOString(),
      };
      migrations.push(newRecord);
      await db.set('migrations', migrations);

      console.log(`✅ Migration ${migration.version} completed.`);
    }

    console.log('✅ All migrations completed.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * 마이그레이션 1.0.0: 초기 스키마 설정
 * - 기존 users, scores, games 데이터를 새 스키마로 변환
 * - 빈 배열로 초기화 (기존 데이터가 없는 경우)
 */
async function migration_1_0_0(): Promise<void> {
  // 기존 데이터 확인
  const oldUsers = await db.get('users') || [];
  const oldScores = await db.get('scores') || [];
  const oldGames = await db.get('games') || [];

  // 새 스키마 컬렉션 초기화 (없는 경우)
  const collections = [
    'users',
    'organizations',
    'sessions',
    'rawMetrics',
    'metricsScores',
    'dailyConditions',
    'dailyMissions',
    'reports',
    'orgReports',
    'riskMembers',
    'rankings',
  ];

  for (const collection of collections) {
    const existing = await db.get(collection);
    if (!existing) {
      await db.set(collection, []);
      console.log(`  ✓ Initialized ${collection}`);
    }
  }

  // 기존 users 데이터 마이그레이션 (userType 추가)
  if (oldUsers.length > 0) {
    const migratedUsers = oldUsers.map((user: any) => ({
      ...user,
      userType: user.userType || 'PERSONAL',
      streak: user.streak || 0,
      brainimalType: user.brainimalType || undefined,
      brainimalConfidence: user.brainimalConfidence || undefined,
    }));
    await db.set('users', migratedUsers);
    console.log(`  ✓ Migrated ${migratedUsers.length} users`);
  }

  // 기존 scores를 sessions로 변환 (간단한 변환)
  if (oldScores.length > 0) {
    const sessions = oldScores.map((score: any) => ({
      id: `session_${score.id}`,
      userId: score.userId,
      mode: score.gameId?.replace('game_', '').toUpperCase() || 'FREE',
      bpm: 80, // 기본값
      level: score.level || 1,
      duration: (score.timeSpent || 0) * 1000, // 초를 ms로 변환
      score: score.score,
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: score.createdAt,
    }));
    await db.set('sessions', sessions);
    console.log(`  ✓ Migrated ${sessions.length} scores to sessions`);
  }

  // 기존 games는 유지 (레거시 호환)
  if (oldGames.length > 0) {
    console.log(`  ✓ Kept ${oldGames.length} games (legacy)`);
  }
}

/**
 * 마이그레이션 상태 확인
 */
export async function getMigrationStatus(): Promise<MigrationRecord[]> {
  try {
    return await db.get('migrations') as MigrationRecord[] || [];
  } catch (error) {
    console.error('❌ Failed to get migration status:', error);
    return [];
  }
}
