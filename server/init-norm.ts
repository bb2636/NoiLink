/**
 * NormConfig 초기 데이터 생성 스크립트
 * 기능 명세서 6.2절 기반
 */

import { db } from './db.js';
import type { NormConfig } from '@noilink/shared';

/**
 * NormConfig 초기 데이터 생성
 * 명세서 6.2절의 초기 규준 데이터 (Norm v1.0) 설정
 */
export async function initializeNormConfig(): Promise<void> {
  try {
    // 기존 설정 확인
    const existing = await db.get('normConfig');
    if (existing) {
      console.log('⚠️  NormConfig already exists. Skipping initialization.');
      return;
    }

    const normConfig: NormConfig = {
      version: 'v1.0',
      updatedAt: new Date().toISOString(),

      // 기억력 규준
      memory: {
        maxSpan: { mu: 5.5, sigma: 1.2 },
        sequenceAccuracy: { mu: 0.8, sigma: 0.15 },
      },

      // 이해력 규준
      comprehension: {
        reactionTime: { mu: 600, sigma: 150 },
        learningSlope: { mu: -50, sigma: 30 },
      },

      // 집중력 규준
      focus: {
        reactionTimeSD: { mu: 120, sigma: 40 },
        lapseCount: { mu: 2.0, sigma: 1.5 },
      },

      // 판단력 규준
      judgment: {
        noGoAccuracy: { mu: 0.9, sigma: 0.1 },
        goReactionTime: { mu: 500, sigma: 100 },
      },

      // 순발력 규준 (기존 멀티태스킹)
      agility: {
        switchCost: { mu: 250, sigma: 100 },
        switchAccuracy: { mu: 0.85, sigma: 0.12 },
        reactionTime: { mu: 400, sigma: 100 }, // 순발력 반응시간 규준 추가
      },

      // 지구력 규준
      endurance: {
        maintainRatio: { mu: 1.10, sigma: 0.15 },
      },
    };

    await db.set('normConfig', normConfig);
    console.log('✅ NormConfig initialized successfully (v1.0)');
  } catch (error) {
    console.error('❌ Failed to initialize NormConfig:', error);
    throw error;
  }
}

/**
 * NormConfig 업데이트 (버전 업그레이드 시)
 */
export async function updateNormConfig(newConfig: Partial<NormConfig>): Promise<void> {
  try {
    const existing = await db.get('normConfig') as NormConfig | null;
    if (!existing) {
      throw new Error('NormConfig does not exist. Run initializeNormConfig first.');
    }

    const updated: NormConfig = {
      ...existing,
      ...newConfig,
      version: newConfig.version || existing.version,
      updatedAt: new Date().toISOString(),
    };

    await db.set('normConfig', updated);
    console.log(`✅ NormConfig updated to version ${updated.version}`);
  } catch (error) {
    console.error('❌ Failed to update NormConfig:', error);
    throw error;
  }
}

/**
 * NormConfig 조회
 */
export async function getNormConfig(): Promise<NormConfig | null> {
  try {
    return await db.get('normConfig') as NormConfig | null;
  } catch (error) {
    console.error('❌ Failed to get NormConfig:', error);
    return null;
  }
}

// 스크립트 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeNormConfig()
    .then(() => {
      console.log('NormConfig initialization completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('NormConfig initialization failed:', error);
      process.exit(1);
    });
}
