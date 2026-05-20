/**
 * Repository 통합 테스트 (Task #159)
 *
 * 실제 Postgres 에 임시 schema 를 만들어 schema.sql 을 그대로 적용하고,
 * 각 repository 의 upsert → find → list → delete 라이프사이클 + JSONB 보존
 * + 인덱스 활용 케이스를 검증한다.
 *
 * 동작 조건:
 *  - 환경변수 `DATABASE_URL` 이 가리키는 Postgres 에 schema 생성/삭제 권한 필요.
 *  - DATABASE_URL 이 없으면 전체 통합 테스트를 skip (CI 에서 의도적으로 빠지도록).
 *
 * 격리 전략:
 *  - `noilink_test_<pid>_<ts>` schema 를 생성하고 pg.Pool 의 `options` 로
 *    search_path 를 그 schema 로 고정 — 운영 public schema 를 절대 건드리지 않는다.
 *  - afterAll 에서 schema CASCADE drop.
 *  - 각 it 사이에는 TRUNCATE ... RESTART IDENTITY CASCADE 로 모든 테이블 비움.
 *  - `vi.mock('./util.js')` 로 repository 함수가 호출하는 getPool() 을 테스트 pool 로 치환.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 운영 schema 와 동일한 DDL 을 실제 Postgres 위에 적용해 테스트한다.
 * pg-mem 같은 in-memory 백엔드는 다음 기능을 지원하지 않아 채택 불가:
 *  - 한 문장에서의 multi-table TRUNCATE
 *  - `ANY($1::text[])` 배열 파라미터 매칭
 *  - 일부 JSONB / index 옵션
 *
 * DATABASE_URL 이 없으면 silent skip 하지 않고 명시적으로 실패시킨다 —
 * 회귀 가드가 CI 에서 침묵하지 않도록 (Task #159 코드리뷰 요구).
 * Replit 환경에서는 항상 셋팅돼 있다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const TEST_SCHEMA = `noilink_test_${process.pid}_${Date.now()}`;

// Pool 은 beforeAll 안에서 만든 뒤 mock 콜백이 참조하도록 외부 변수로 둔다.
let testPool: pg.Pool | null = null;

vi.mock('./util.js', async () => {
  const actual: typeof import('./util.js') = await vi.importActual('./util.js');
  return {
    ...actual,
    getPool: async () => {
      if (!testPool) throw new Error('testPool not initialized');
      return testPool;
    },
  };
});

// 동적 import — mock 이 먼저 등록된 뒤 repository 모듈을 로드해야 함.
const Users = await import('./users.js');
const Sessions = await import('./sessions.js');
const Metrics = await import('./metrics-scores.js');
const Raw = await import('./raw-metrics.js');
const Passwords = await import('./passwords.js');
const Orgs = await import('./organizations.js');
const Reports = await import('./reports.js');
const Rankings = await import('./rankings.js');
const Daily = await import('./daily.js');
const Events = await import('./events.js');
const Terms = await import('./terms.js');

describe('Repository integration (Postgres, isolated schema)', () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      // 명시적 실패 — silent skip 으로 회귀 가드가 침묵하는 것을 막는다.
      throw new Error(
        'Repository integration tests require DATABASE_URL. ' +
          'Set DATABASE_URL to a Postgres instance (the test creates and drops an isolated schema).'
      );
    }
    // 1) 임시 schema 생성용 부트스트랩 pool (search_path 미지정).
    const bootstrap = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      await bootstrap.query(`CREATE SCHEMA "${TEST_SCHEMA}"`);
    } finally {
      await bootstrap.end();
    }

    // 2) 실제 테스트용 pool — 모든 connection 의 search_path 를 TEST_SCHEMA 로 고정.
    testPool = new pg.Pool({
      connectionString: DATABASE_URL,
      options: `-csearch_path=${TEST_SCHEMA}`,
      max: 4,
    });

    // 3) schema.sql 을 그대로 실행 — 운영과 동일한 DDL 보장.
    const schemaSql = fs.readFileSync(
      path.resolve(__dirname, '..', 'schema.sql'),
      'utf-8'
    );
    await testPool.query(schemaSql);
  }, 30_000);

  afterAll(async () => {
    if (testPool) {
      await testPool.end();
      testPool = null;
    }
    const cleanup = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      await cleanup.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
    } finally {
      await cleanup.end();
    }
  }, 30_000);

  beforeEach(async () => {
    if (!testPool) return;
    await testPool.query(`
      TRUNCATE
        users, passwords, organizations, terms,
        sessions, metrics_scores, raw_metrics,
        rankings, reports, org_insight_reports,
        daily_conditions, daily_missions,
        ble_abort_events, ack_banner_events, inquiries,
        kv_store
      RESTART IDENTITY CASCADE
    `);
  });

  // ------------------------------------------------------------------
  // users
  // ------------------------------------------------------------------
  describe('users', () => {
    const baseUser = {
      id: 'u1',
      username: 'alice',
      email: 'alice@example.com',
      name: 'Alice',
      userType: 'PERSONAL' as const,
      streak: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    it('upsert → findById / Username / Email 라운드트립', async () => {
      await Users.upsertUser(baseUser as any);
      const byId = await Users.findUserById('u1');
      expect(byId).toMatchObject({
        id: 'u1',
        username: 'alice',
        email: 'alice@example.com',
        name: 'Alice',
        userType: 'PERSONAL',
        streak: 3,
      });
      // createdAt 은 ISO string 으로 정규화 돼야 함
      expect(typeof byId!.createdAt).toBe('string');
      expect(new Date(byId!.createdAt).toISOString()).toBe(baseUser.createdAt);

      expect(await Users.findUserByUsername('alice')).toMatchObject({ id: 'u1' });
      expect(await Users.findUserByEmail('alice@example.com')).toMatchObject({ id: 'u1' });
      expect(await Users.findUserByUsername('nobody')).toBeNull();
    });

    it('upsert 두 번이면 update 되고 row 가 1개로 유지된다 (ON CONFLICT)', async () => {
      await Users.upsertUser(baseUser as any);
      await Users.upsertUser({ ...baseUser, name: 'Alice2', streak: 9 } as any);
      const u = await Users.findUserById('u1');
      expect(u).toMatchObject({ name: 'Alice2', streak: 9 });
      expect(await Users.countUsers()).toBe(1);
    });

    it('extra JSONB 가 알려지지 않은 필드를 보존하고 rowToUser 가 머지한다', async () => {
      await Users.upsertUser({
        ...baseUser,
        // 알려지지 않은 임의 필드들
        favoriteColor: 'blue',
        experiment: { bucket: 'A', seed: 42 },
      } as any);
      const u: any = await Users.findUserById('u1');
      expect(u.favoriteColor).toBe('blue');
      expect(u.experiment).toEqual({ bucket: 'A', seed: 42 });
    });

    it('findUserBySocial / 조직별/타입별/전체 list + softDelete 필터', async () => {
      await Users.upsertUser({
        ...baseUser,
        id: 'u1',
        organizationId: 'org1',
        socialProvider: 'kakao',
        socialId: 'kakao-123',
      } as any);
      await Users.upsertUser({
        ...baseUser,
        id: 'u2',
        username: 'bob',
        email: 'bob@example.com',
        organizationId: 'org1',
        userType: 'ORGANIZATION',
        createdAt: '2026-01-02T00:00:00.000Z',
      } as any);
      await Users.upsertUser({
        ...baseUser,
        id: 'u3',
        username: 'carol',
        email: 'carol@example.com',
        organizationId: 'org2',
        createdAt: '2026-01-03T00:00:00.000Z',
      } as any);

      expect(await Users.findUserBySocial('kakao', 'kakao-123')).toMatchObject({ id: 'u1' });
      expect(await Users.findUserBySocial('kakao', 'nope')).toBeNull();

      const org1Users = await Users.listUsersByOrganization('org1');
      expect(org1Users.map((u) => u.id)).toEqual(['u1', 'u2']); // created_at ASC

      const orgType = await Users.listUsersByType('ORGANIZATION' as any);
      expect(orgType.map((u) => u.id)).toEqual(['u2']);

      expect((await Users.listAllUsers()).map((u) => u.id)).toEqual(['u1', 'u2', 'u3']);
      expect(await Users.countUsers()).toBe(3);

      // soft delete → 기본 list/count 에서 제외
      await Users.softDeleteUser('u2');
      expect((await Users.listAllUsers()).map((u) => u.id)).toEqual(['u1', 'u3']);
      expect(await Users.countUsers()).toBe(2);
      expect((await Users.listAllUsers({ includeDeleted: true })).map((u) => u.id))
        .toEqual(['u1', 'u2', 'u3']);
      expect(
        (await Users.listUsersByOrganization('org1', { includeDeleted: true })).map((u) => u.id)
      ).toEqual(['u1', 'u2']);

      await Users.deleteUser('u3');
      expect(await Users.findUserById('u3')).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // passwords
  // ------------------------------------------------------------------
  describe('passwords', () => {
    it('upsert → findByUserId / findByEmail / delete', async () => {
      await Passwords.upsertPassword({
        userId: 'u1',
        email: 'p@example.com',
        passwordHash: 'hash-v1',
        mustChange: true,
        createdAt: '2026-02-01T00:00:00.000Z',
      });
      const byId = await Passwords.findPasswordByUserId('u1');
      expect(byId).toMatchObject({
        userId: 'u1',
        email: 'p@example.com',
        passwordHash: 'hash-v1',
        mustChange: true,
      });
      expect(await Passwords.findPasswordByEmail('p@example.com')).toMatchObject({ userId: 'u1' });

      // update via ON CONFLICT
      await Passwords.upsertPassword({
        userId: 'u1',
        email: 'p@example.com',
        passwordHash: 'hash-v2',
        mustChange: false,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
      });
      const updated = await Passwords.findPasswordByUserId('u1');
      expect(updated).toMatchObject({ passwordHash: 'hash-v2', mustChange: false });
      expect(updated!.updatedAt).toBeTruthy();

      await Passwords.deletePassword('u1');
      expect(await Passwords.findPasswordByUserId('u1')).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // organizations
  // ------------------------------------------------------------------
  describe('organizations', () => {
    it('upsert / find / list / delete + memberUserIds 배열 JSONB 보존', async () => {
      await Orgs.upsertOrganization({
        id: 'org1',
        name: 'Org One',
        adminUserId: 'u1',
        memberUserIds: ['u1', 'u2', 'u3'],
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await Orgs.upsertOrganization({
        id: 'org2',
        name: 'Org Two',
        adminUserId: 'u9',
        memberUserIds: [],
        createdAt: '2026-01-02T00:00:00.000Z',
      });

      const o = await Orgs.findOrganizationById('org1');
      expect(o).toMatchObject({
        id: 'org1',
        name: 'Org One',
        adminUserId: 'u1',
        memberUserIds: ['u1', 'u2', 'u3'],
      });
      // 배열 순서·요소 그대로 보존
      expect(o!.memberUserIds).toEqual(['u1', 'u2', 'u3']);

      const all = await Orgs.listOrganizations();
      expect(all.map((x) => x.id)).toEqual(['org1', 'org2']); // created_at ASC

      // memberUserIds 가 비어 있으면 빈 배열로 들어와야 함
      const empty = await Orgs.findOrganizationById('org2');
      expect(empty!.memberUserIds).toEqual([]);

      // extra 필드 보존
      await Orgs.upsertOrganization({
        id: 'org3',
        name: 'Org Three',
        adminUserId: 'u1',
        memberUserIds: ['u1'],
        createdAt: '2026-01-03T00:00:00.000Z',
        // 알려지지 않은 메타
        industry: 'edtech',
      } as any);
      const o3: any = await Orgs.findOrganizationById('org3');
      expect(o3.industry).toBe('edtech');

      await Orgs.deleteOrganization('org3');
      expect(await Orgs.findOrganizationById('org3')).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // sessions + metrics_scores + raw_metrics
  // ------------------------------------------------------------------
  describe('sessions', () => {
    const baseSession = {
      id: 's1',
      userId: 'u1',
      mode: 'COMPOSITE' as const,
      bpm: 80,
      level: 2 as any,
      duration: 300_000,
      score: 75,
      isComposite: true,
      isValid: true,
      phases: [
        {
          type: 'COGNITIVE',
          startTime: 0,
          endTime: 60_000,
          duration: 60_000,
          mode: 'MEMORY',
          bpm: 80,
          level: 2,
          tickCount: 30,
          hitCount: 25,
          missCount: 5,
        },
      ] as any,
      meta: { partial: { progressPct: 100 } } as any,
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    it('upsert / find / 필터별 list / count / 인덱스 활용', async () => {
      await Sessions.upsertSession(baseSession as any);
      const s = await Sessions.findSessionById('s1');
      expect(s).toMatchObject({
        id: 's1',
        userId: 'u1',
        mode: 'COMPOSITE',
        bpm: 80,
        score: 75,
        isComposite: true,
        isValid: true,
      });
      // JSONB phases / meta 보존
      expect(Array.isArray(s!.phases)).toBe(true);
      expect(s!.phases![0]).toMatchObject({ type: 'COGNITIVE', mode: 'MEMORY' });
      expect((s!.meta as any).partial.progressPct).toBe(100);

      // 여러 세션
      await Sessions.upsertSession({ ...baseSession, id: 's2', isComposite: false, createdAt: '2026-03-02T00:00:00.000Z' } as any);
      await Sessions.upsertSession({ ...baseSession, id: 's3', userId: 'u2', createdAt: '2026-03-03T00:00:00.000Z' } as any);
      await Sessions.upsertSession({ ...baseSession, id: 's4', isValid: false, createdAt: '2026-03-04T00:00:00.000Z' } as any);

      // userId 필터 + 정렬 desc(default)
      const u1Sessions = await Sessions.listSessions({ userId: 'u1' });
      expect(u1Sessions.map((x) => x.id)).toEqual(['s4', 's2', 's1']);

      // composite=true, valid=true → 인덱스(idx_sessions_composite) 대상
      const compU1 = await Sessions.listCompositeSessionsByUser('u1');
      expect(compU1.map((x) => x.id)).toEqual(['s1']);

      // sinceCreatedAt / beforeCreatedAt 경계
      const since = await Sessions.listSessions({
        userId: 'u1',
        sinceCreatedAt: '2026-03-02T00:00:00.000Z',
        order: 'asc',
      });
      expect(since.map((x) => x.id)).toEqual(['s2', 's4']);

      const before = await Sessions.listSessions({
        userId: 'u1',
        beforeCreatedAt: '2026-03-04T00:00:00.000Z',
        order: 'asc',
      });
      expect(before.map((x) => x.id)).toEqual(['s1', 's2']);

      // limit
      const limited = await Sessions.listSessions({ userId: 'u1', limit: 2 });
      expect(limited).toHaveLength(2);

      // count 옵션
      expect(await Sessions.countSessionsByUser('u1')).toBe(3);
      expect(await Sessions.countSessionsByUser('u1', { isComposite: true })).toBe(2);
      expect(await Sessions.countSessionsByUser('u1', { isComposite: true, isValid: true })).toBe(1);

      // update (ON CONFLICT)
      await Sessions.upsertSession({ ...baseSession, score: 99 } as any);
      const s1 = await Sessions.findSessionById('s1');
      expect(s1!.score).toBe(99);

      await Sessions.deleteSession('s2');
      expect(await Sessions.findSessionById('s2')).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // metrics_scores
  // ------------------------------------------------------------------
  describe('metrics_scores', () => {
    it('upsert / find / listByUser / listBySessionIds (ANY array)', async () => {
      await Metrics.upsertMetricsScore({
        sessionId: 's1', userId: 'u1',
        memory: 70, comprehension: 80, focus: 65, judgment: 75, agility: 60, endurance: 85, rhythm: 90,
        createdAt: '2026-03-01T00:00:00.000Z',
      });
      await Metrics.upsertMetricsScore({
        sessionId: 's2', userId: 'u1',
        memory: 72, comprehension: 82, focus: 67, judgment: 77, agility: 62, endurance: 87, rhythm: 92,
        createdAt: '2026-03-02T00:00:00.000Z',
      });
      await Metrics.upsertMetricsScore({
        sessionId: 's3', userId: 'u2',
        memory: 50, createdAt: '2026-03-03T00:00:00.000Z',
      });

      const found = await Metrics.findMetricsBySessionId('s1');
      expect(found).toMatchObject({ sessionId: 's1', memory: 70, rhythm: 90 });

      const u1 = await Metrics.listMetricsByUser('u1');
      expect(u1.map((m) => m.sessionId)).toEqual(['s2', 's1']); // desc

      const byIds = await Metrics.listMetricsBySessionIds(['s1', 's3', 'missing']);
      expect(byIds.map((m) => m.sessionId).sort()).toEqual(['s1', 's3']);
      expect(await Metrics.listMetricsBySessionIds([])).toEqual([]);

      // upsert update path
      await Metrics.upsertMetricsScore({
        sessionId: 's1', userId: 'u1', memory: 99,
        createdAt: '2026-03-01T00:00:00.000Z',
      });
      expect((await Metrics.findMetricsBySessionId('s1'))!.memory).toBe(99);
    });
  });

  // ------------------------------------------------------------------
  // raw_metrics
  // ------------------------------------------------------------------
  describe('raw_metrics', () => {
    it('upsert / find / list + JSONB 보존', async () => {
      const raw: any = {
        sessionId: 's1', userId: 'u1',
        touchCount: 100, hitCount: 80, rtMean: 450, rtSD: 80,
        byModeMetrics: { MEMORY: { spans: [3, 4, 5] }, AGILITY: { simulHit: 3 } },
        memory: { maxSpan: 5, sequenceAccuracy: 0.83 } as any,
        agility: { switchCost: 220, switchAccuracy: 0.86 } as any,
        createdAt: '2026-03-01T00:00:00.000Z',
      };
      await Raw.upsertRawMetrics(raw);
      const got: any = await Raw.findRawMetricsBySessionId('s1');
      expect(got).toMatchObject({
        sessionId: 's1', userId: 'u1', touchCount: 100, hitCount: 80, rtMean: 450, rtSD: 80,
      });
      // 회귀 가드: shared 의 RawMetrics 는 'rtSD' 를 쓰지만 snake→camel 변환은
      // 'rt_sd' → 'rtSd' 를 만든다. raw-metrics.ts 의 rowToRaw 가 명시적으로
      // 보정해야 한다 (Task #159 통합 테스트가 처음 발견한 contract drift).
      expect(got.rtSD).toBe(80);
      expect(got.rtSd).toBeUndefined();
      // JSONB 라운드트립
      expect(got.byModeMetrics).toEqual({ MEMORY: { spans: [3, 4, 5] }, AGILITY: { simulHit: 3 } });
      expect(got.memory).toEqual({ maxSpan: 5, sequenceAccuracy: 0.83 });
      expect(got.agility).toEqual({ switchCost: 220, switchAccuracy: 0.86 });

      await Raw.upsertRawMetrics({
        sessionId: 's2', userId: 'u1', touchCount: 10, hitCount: 5, rtMean: 600, rtSD: 100,
        createdAt: '2026-03-02T00:00:00.000Z',
      } as any);

      const list = await Raw.listRawMetricsByUser('u1');
      expect(list.map((r) => r.sessionId)).toEqual(['s2', 's1']);
      const limited = await Raw.listRawMetricsByUser('u1', { limit: 1 });
      expect(limited.map((r) => r.sessionId)).toEqual(['s2']);
    });
  });

  // ------------------------------------------------------------------
  // reports + org_insight_reports
  // ------------------------------------------------------------------
  describe('reports', () => {
    it('insert / findLatestByUser / listByUser + payload 머지', async () => {
      const baseReport: any = {
        id: 'r1', userId: 'u1', reportVersion: 1,
        brainimalType: 'TIGER', confidence: 88,
        metricsScore: { sessionId: 's1', userId: 'u1', memory: 70, createdAt: '2026-03-01T00:00:00Z' },
        factText: 'fact', lifeText: 'life', hintText: 'hint',
        strengthText: '강점', weaknessText: '약점',
        metricEvidenceCards: [{ key: 'memory', label: '기억력', body: 'b1' }],
        recommendedRoleModel: { name: 'X', oneLiner: '1', description: 'd' },
        createdAt: '2026-03-01T00:00:00.000Z',
      };
      await Reports.insertReport(baseReport);
      await Reports.insertReport({
        ...baseReport, id: 'r2', reportVersion: 2, confidence: 90,
        createdAt: '2026-03-05T00:00:00.000Z',
      });

      const latest = await Reports.findLatestReportByUser('u1');
      expect(latest!.id).toBe('r2');
      expect(latest!.confidence).toBe(90);
      // payload 머지: factText 등 payload 안 필드가 살아남아야 함
      expect(latest!.factText).toBe('fact');
      expect(latest!.metricsScore.memory).toBe(70);

      const all = await Reports.listReportsByUser('u1');
      expect(all.map((r) => r.id)).toEqual(['r2', 'r1']);
      expect((await Reports.listReportsByUser('u1', { limit: 1 })).map((r) => r.id)).toEqual(['r2']);

      // re-insert same id → update via ON CONFLICT
      await Reports.insertReport({ ...baseReport, id: 'r1', confidence: 11 });
      const r1 = (await Reports.listReportsByUser('u1')).find((r) => r.id === 'r1');
      expect(r1!.confidence).toBe(11);
    });

    it('org_insight_reports insert / findLatest', async () => {
      const baseOrg: any = {
        id: 'or1', organizationId: 'org1', organizationName: 'Org One',
        managedMemberCount: 10, avgBrainAge: 35, cohortActualAvgAge: 40,
        brainAgeVsChronologicalDelta: -5,
        representativeBrainimal: 'TIGER', representativeBrainimalLabel: '호랑이',
        avgMetricsScore: { sessionId: 'agg', userId: 'agg', memory: 70, createdAt: '2026-03-01T00:00:00Z' },
        factText: 'f', lifeText: 'l', hintText: 'h', strengthText: 's', weaknessText: 'w',
        metricEvidenceCards: [],
        brainimalDistribution: [{ type: 'TIGER', count: 5, percent: 50 }],
        memberStatusSummary: '요약',
        createdAt: '2026-03-01T00:00:00.000Z',
      };
      await Reports.insertOrgInsightReport(baseOrg);
      await Reports.insertOrgInsightReport({
        ...baseOrg, id: 'or2', avgBrainAge: 33, createdAt: '2026-03-05T00:00:00.000Z',
      });
      const latest: any = await Reports.findLatestOrgInsightReport('org1');
      expect(latest.id).toBe('or2');
      expect(latest.avgBrainAge).toBe(33);
      // payload 머지 — organizationName, brainimalDistribution 살아남음
      expect(latest.organizationName).toBe('Org One');
      expect(latest.brainimalDistribution).toEqual([{ type: 'TIGER', count: 5, percent: 50 }]);

      expect(await Reports.findLatestOrgInsightReport('missing')).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // rankings
  // ------------------------------------------------------------------
  describe('rankings', () => {
    it('replaceAll → list (필터/정렬) → clear', async () => {
      await Rankings.replaceAllRankings([
        {
          userId: 'u1', username: 'a', userType: 'PERSONAL', rankingType: 'COMPOSITE_SCORE',
          score: 90, rank: 1, calculatedAt: '2026-03-01T00:00:00Z',
        } as any,
        {
          userId: 'u2', username: 'b', userType: 'PERSONAL', rankingType: 'COMPOSITE_SCORE',
          score: 80, rank: 2, calculatedAt: '2026-03-01T00:00:00Z',
        } as any,
        {
          userId: 'u3', username: 'c', userType: 'ORGANIZATION', organizationId: 'org1',
          rankingType: 'STREAK', score: 7, rank: 1, calculatedAt: '2026-03-01T00:00:00Z',
        } as any,
      ]);

      const allComposite = await Rankings.listRankings({ rankingType: 'COMPOSITE_SCORE' });
      expect(allComposite.map((r) => r.userId)).toEqual(['u1', 'u2']); // rank ASC

      const byOrg = await Rankings.listRankings({ organizationId: 'org1' });
      expect(byOrg.map((r) => r.userId)).toEqual(['u3']);

      const byUser = await Rankings.listRankings({ userId: 'u1' });
      expect(byUser.map((r) => r.userId)).toEqual(['u1']);

      // replaceAll 은 기존 row 를 모두 비우고 새로 채워야 함
      await Rankings.replaceAllRankings([
        {
          userId: 'u9', username: 'z', userType: 'PERSONAL', rankingType: 'TOTAL_TIME',
          score: 1000, rank: 1, calculatedAt: '2026-03-02T00:00:00Z',
        } as any,
      ]);
      const after = await Rankings.listRankings();
      expect(after.map((r) => r.userId)).toEqual(['u9']);

      await Rankings.clearRankings();
      expect(await Rankings.listRankings()).toEqual([]);
    });

    it('replaceAll 빈 배열 → 모두 비움', async () => {
      await Rankings.replaceAllRankings([
        {
          userId: 'u1', username: 'a', userType: 'PERSONAL', rankingType: 'COMPOSITE_SCORE',
          score: 50, rank: 1, calculatedAt: '2026-03-01T00:00:00Z',
        } as any,
      ]);
      expect((await Rankings.listRankings()).length).toBe(1);
      await Rankings.replaceAllRankings([]);
      expect(await Rankings.listRankings()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // daily_conditions / daily_missions
  // ------------------------------------------------------------------
  describe('daily', () => {
    it('upsert / find / list — (userId,date) 복합 PK', async () => {
      await Daily.upsertDailyCondition({
        userId: 'u1', date: '2026-03-01', score: 70, badge: 'GOOD' as any,
        avgReactionTime: 450, avgAccuracy: 0.8, errorCount: 3, duration: 300_000,
        calculatedAt: '2026-03-01T00:00:00Z',
      });
      await Daily.upsertDailyCondition({
        userId: 'u1', date: '2026-03-02', score: 75, badge: 'GREAT' as any,
        avgReactionTime: 440, avgAccuracy: 0.82, errorCount: 2, duration: 300_000,
        calculatedAt: '2026-03-02T00:00:00Z',
      });
      // 같은 (userId, date) 로 다시 upsert → 1건 유지, payload 갱신
      await Daily.upsertDailyCondition({
        userId: 'u1', date: '2026-03-01', score: 99, badge: 'GOOD' as any,
        avgReactionTime: 400, avgAccuracy: 0.95, errorCount: 0, duration: 300_000,
        calculatedAt: '2026-03-01T01:00:00Z',
      });
      const cond = await Daily.findDailyCondition('u1', '2026-03-01');
      expect(cond).toMatchObject({ score: 99, avgAccuracy: 0.95 });

      const list = await Daily.listDailyConditionsByUser('u1');
      expect(list.map((c) => c.date)).toEqual(['2026-03-02', '2026-03-01']); // date DESC

      const since = await Daily.listDailyConditionsByUser('u1', { sinceDate: '2026-03-02' });
      expect(since.map((c) => c.date)).toEqual(['2026-03-02']);

      // missions
      await Daily.upsertDailyMission({
        userId: 'u1', date: '2026-03-01', targetBPM: 80, targetAccuracy: 75,
        description: 'm1', createdAt: '2026-03-01T00:00:00Z',
      });
      const m = await Daily.findDailyMission('u1', '2026-03-01');
      expect(m).toMatchObject({ targetBPM: 80, targetAccuracy: 75, description: 'm1' });
      expect(await Daily.findDailyMission('u1', '2026-03-99')).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // events (ble_abort / ack_banner / inquiries)
  // ------------------------------------------------------------------
  describe('events', () => {
    it('insert / list 필터링 + payload 보존 (3 테이블 공통)', async () => {
      await Events.insertBleAbortEvent({
        id: 'e1', userId: 'u1', sessionId: 's1',
        createdAt: '2026-03-01T00:00:00Z', reason: 'TIMEOUT', detail: { ms: 1234 },
      });
      await Events.insertBleAbortEvent({
        id: 'e2', userId: 'u1', sessionId: 's2',
        createdAt: '2026-03-02T00:00:00Z', reason: 'RECONNECT_FAILED',
      });
      await Events.insertBleAbortEvent({
        id: 'e3', userId: 'u2',
        createdAt: '2026-03-03T00:00:00Z', reason: 'OTHER',
      });

      const u1 = await Events.listBleAbortEvents({ userId: 'u1' });
      expect(u1.map((e) => e.id)).toEqual(['e2', 'e1']); // desc
      expect((u1[1] as any).reason).toBe('TIMEOUT');
      expect((u1[1] as any).detail).toEqual({ ms: 1234 });

      const since = await Events.listBleAbortEvents({ sinceCreatedAt: '2026-03-02T00:00:00Z' });
      expect(since.map((e) => e.id).sort()).toEqual(['e2', 'e3']);

      const limited = await Events.listBleAbortEvents({ userId: 'u1', limit: 1 });
      expect(limited.map((e) => e.id)).toEqual(['e2']);

      // ack_banner_events / inquiries 도 같은 API 형태
      await Events.insertAckBannerEvent({
        id: 'a1', userId: 'u1', createdAt: '2026-03-01T00:00:00Z', toast: 'reject',
      });
      expect((await Events.listAckBannerEvents({ userId: 'u1' }))[0].id).toBe('a1');

      await Events.insertInquiry({
        id: 'iq1', userId: 'u1', sessionId: 's1', createdAt: '2026-03-01T00:00:00Z',
        title: 'hello', body: 'world',
      });
      const iq = await Events.listInquiries({ userId: 'u1' });
      expect(iq[0]).toMatchObject({ id: 'iq1', sessionId: 's1', title: 'hello', body: 'world' });

      // insert 같은 id → payload 업데이트 (ON CONFLICT)
      await Events.insertBleAbortEvent({
        id: 'e1', userId: 'u1', sessionId: 's1',
        createdAt: '2026-03-01T00:00:00Z', reason: 'CHANGED',
      });
      const updated = await Events.listBleAbortEvents({ userId: 'u1' });
      const e1 = updated.find((e) => e.id === 'e1');
      expect((e1 as any).reason).toBe('CHANGED');
    });
  });

  // ------------------------------------------------------------------
  // terms
  // ------------------------------------------------------------------
  describe('terms', () => {
    it('upsert / find / listByType (activeOnly) / listAll / delete', async () => {
      await Terms.upsertTerms({
        id: 't1', type: 'SERVICE', title: '서비스 v1', content: '내용', version: 1,
        isRequired: true, isActive: false, createdAt: '2026-01-01T00:00:00Z',
      });
      await Terms.upsertTerms({
        id: 't2', type: 'SERVICE', title: '서비스 v2', content: '내용', version: 2,
        isRequired: true, isActive: true, createdAt: '2026-01-02T00:00:00Z',
      });
      await Terms.upsertTerms({
        id: 't3', type: 'PRIVACY', title: '개인정보 v1', content: '내용', version: 1,
        isRequired: true, isActive: true, createdAt: '2026-01-03T00:00:00Z',
      });

      expect(await Terms.findTermsById('t1')).toMatchObject({ title: '서비스 v1' });

      const svc = await Terms.listTermsByType('SERVICE');
      expect(svc.map((t) => t.id)).toEqual(['t2', 't1']); // version DESC

      const svcActive = await Terms.listTermsByType('SERVICE', { activeOnly: true });
      expect(svcActive.map((t) => t.id)).toEqual(['t2']);

      const all = await Terms.listAllTerms();
      // type ASC, version DESC (PRIVACY < SERVICE 알파벳)
      expect(all.map((t) => t.id)).toEqual(['t3', 't2', 't1']);

      // ON CONFLICT update
      await Terms.upsertTerms({
        id: 't1', type: 'SERVICE', title: '서비스 v1.5', content: '갱신', version: 1,
        isRequired: false, isActive: true, createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-10T00:00:00Z', createdBy: 'admin',
      });
      const t1 = await Terms.findTermsById('t1');
      expect(t1).toMatchObject({ title: '서비스 v1.5', isRequired: false, isActive: true, createdBy: 'admin' });

      await Terms.deleteTerms('t1');
      expect(await Terms.findTermsById('t1')).toBeNull();
    });
  });
});
