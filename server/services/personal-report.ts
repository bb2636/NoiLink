/**
 * 개인 리포트 생성·저장 (트레이닝 후 자동 호출 가능)
 */
import {
  findUserById,
  listCompositeSessionsByUser,
  listMetricsBySessionIds,
  insertReport,
  upsertUser,
} from '../db/repositories/index.js';
import { determineBrainimalType } from './brainimal-detector.js';
import { generateReport } from './report-generator.js';
import { computeBrainAge } from '../utils/brain-age.js';
import type { Report, MetricsScore } from '@noilink/shared';

export async function generateAndSavePersonalReport(userId: string): Promise<Report | null> {
  try {
    const user = await findUserById(userId);
    if (!user) return null;

    const userSessions = await listCompositeSessionsByUser(userId, { limit: 5 });
    if (userSessions.length < 3) return null;

    const metricsBySession = await listMetricsBySessionIds(userSessions.map((s) => s.id));
    const metricsBySid = new Map(metricsBySession.map((m) => [m.sessionId, m]));
    const recentScores = userSessions
      .map((s) => metricsBySid.get(s.id))
      .filter((m): m is MetricsScore => m !== undefined);

    if (recentScores.length < 3) return null;

    const { type: brainimalType, confidence } = determineBrainimalType(recentScores);
    if (!brainimalType) return null;

    const reportVersion = userSessions.length;
    const latestMetrics = recentScores[0];
    const report = generateReport(
      userId,
      user.name,
      reportVersion,
      brainimalType,
      latestMetrics,
      confidence
    );

    await insertReport(report);

    const nextBrainAge = computeBrainAge(latestMetrics, user.age);
    const updated = { ...user };
    if (updated.brainAge !== undefined && updated.brainAge !== null) {
      updated.previousBrainAge = updated.brainAge;
    }
    updated.brainAge = nextBrainAge;
    updated.brainimalType = brainimalType;
    updated.brainimalConfidence = confidence;
    await upsertUser(updated);

    return report;
  } catch {
    return null;
  }
}
