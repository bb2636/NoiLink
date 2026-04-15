/**
 * 개인 리포트 생성·저장 (트레이닝 후 자동 호출 가능)
 */
import { db } from '../db.js';
import { determineBrainimalType } from './brainimal-detector.js';
import { generateReport } from './report-generator.js';
import { computeBrainAge } from '../utils/brain-age.js';
import type { Report, MetricsScore, Session, User } from '@noilink/shared';

export async function generateAndSavePersonalReport(userId: string): Promise<Report | null> {
  try {
    const users: User[] = (await db.get('users')) || [];
    const user = users.find((u) => u.id === userId);
    if (!user) return null;

    const sessions: Session[] = (await db.get('sessions')) || [];
    const userSessions = sessions
      .filter((s) => s.userId === userId && s.isComposite && s.isValid)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 5);

    if (userSessions.length < 3) return null;

    const metricsScores: MetricsScore[] = (await db.get('metricsScores')) || [];
    const recentScores = userSessions
      .map((s) => metricsScores.find((m) => m.sessionId === s.id))
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

    const reports: Report[] = (await db.get('reports')) || [];
    reports.push(report);
    await db.set('reports', reports);

    const userIndex = users.findIndex((u) => u.id === userId);
    if (userIndex !== -1) {
      const u = users[userIndex];
      const nextBrainAge = computeBrainAge(latestMetrics, u.age);
      if (u.brainAge !== undefined && u.brainAge !== null) {
        u.previousBrainAge = u.brainAge;
      }
      u.brainAge = nextBrainAge;
      u.brainimalType = brainimalType;
      u.brainimalConfidence = confidence;
      await db.set('users', users);
    }

    return report;
  } catch {
    return null;
  }
}
