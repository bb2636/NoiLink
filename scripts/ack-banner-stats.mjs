// ack 거부 토스트(`subscribeAckErrorBanner`) 의 burst 통계를 한 줄로 출력하는
// 운영 스크립트 (Task #128).
//
// docs/operations/ack-banner-telemetry.md §3 의 SQL 한 건은 PostgreSQL 백엔드
// (Neon/Supabase) 에서만 동작한다. 로컬 JSON / Replit DB 백엔드(개발/QA)에서는
// `ackBannerEvents` 키를 직접 읽어 같은 집계를 돌려야 임계값 튜닝 회의 자료를
// 동일한 명령으로 뽑을 수 있다.
//
// 본 스크립트는 `server/db.ts` 의 동일 추상화를 거치므로 환경 변수가 가리키는
// 백엔드(PostgreSQL/Replit/로컬 JSON) 어느 것이든 같은 한 줄을 출력한다.
//
// 사용법:
//   node scripts/ack-banner-stats.mjs --days 7
//
// 출력 예시 (reason 별 한 줄, events DESC 정렬):
//   [ack-banner-stats] window_days=7 reason=auto-dismiss events=42 \
//     avg_burst_count=2.10 avg_burst_ms=4120 p50_burst_ms=4500 p95_burst_ms=4980

import { register } from 'tsx/esm/api';

const unregister = register();

const { db } = await import('../server/db.ts');

function parseArgs(argv) {
  let days = 7;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--days' && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) days = n;
      i++;
    } else if (arg.startsWith('--days=')) {
      const n = Number(arg.slice('--days='.length));
      if (Number.isFinite(n) && n > 0) days = n;
    } else if (arg === '-h' || arg === '--help') {
      console.log('Usage: node scripts/ack-banner-stats.mjs [--days N]');
      process.exit(0);
    }
  }
  return { days };
}

// PostgreSQL 의 PERCENTILE_CONT 와 동일한 선형 보간 — 두 백엔드의 출력 값이
// 같은 분포에서 같은 숫자를 내도록 맞춘다.
function percentileCont(sortedNumbers, p) {
  const n = sortedNumbers.length;
  if (n === 0) return 0;
  if (n === 1) return sortedNumbers[0];
  const rank = (n - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedNumbers[lo];
  const frac = rank - lo;
  return sortedNumbers[lo] + (sortedNumbers[hi] - sortedNumbers[lo]) * frac;
}

async function main() {
  const { days } = parseArgs(process.argv.slice(2));
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const raw = await db.get('ackBannerEvents');
  const events = Array.isArray(raw) ? raw : [];

  // reason 별 그룹 — Postgres 의 GROUP BY reason 과 동일.
  const groups = new Map();
  let withinWindow = 0;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const occurredAtMs = Date.parse(e.occurredAt);
    // Postgres SQL 도 occurredAt 이 NULL/파싱 불가면 비교에서 떨어져 같은 결과가 된다.
    if (!Number.isFinite(occurredAtMs) || occurredAtMs <= cutoffMs) continue;
    const burstCount = Number(e.burstCount);
    const burstDurationMs = Number(e.burstDurationMs);
    if (!Number.isFinite(burstCount) || !Number.isFinite(burstDurationMs)) continue;
    const reason = String(e.reason ?? 'unknown');
    let g = groups.get(reason);
    if (!g) {
      g = { reason, events: 0, sumBurstCount: 0, durations: [] };
      groups.set(reason, g);
    }
    g.events += 1;
    g.sumBurstCount += burstCount;
    g.durations.push(burstDurationMs);
    withinWindow += 1;
  }

  if (withinWindow === 0) {
    console.log(
      `[ack-banner-stats] window_days=${days} events=0 — 집계할 이벤트가 없습니다.`,
    );
  } else {
    // events DESC — Postgres SQL 의 ORDER BY events DESC 와 동일.
    const rows = [...groups.values()].sort((a, b) => b.events - a.events);
    for (const g of rows) {
      g.durations.sort((a, b) => a - b);
      const avgBurstCount = g.sumBurstCount / g.events;
      const avgBurstMs =
        g.durations.reduce((s, n) => s + n, 0) / g.durations.length;
      const p50 = percentileCont(g.durations, 0.5);
      const p95 = percentileCont(g.durations, 0.95);
      console.log(
        `[ack-banner-stats] window_days=${days} reason=${g.reason} ` +
          `events=${g.events} avg_burst_count=${avgBurstCount.toFixed(2)} ` +
          `avg_burst_ms=${Math.round(avgBurstMs)} ` +
          `p50_burst_ms=${Math.round(p50)} p95_burst_ms=${Math.round(p95)}`,
      );
    }
  }

  // dbWrapper 가 connect 시점에 잡은 풀/파일 핸들을 닫아 프로세스가 자연스럽게 종료되도록.
  try {
    await db.disconnect();
  } catch {
    // disconnect 실패는 운영 집계 결과에 영향을 주지 않도록 조용히 무시.
  }
  await unregister();
}

main()
  .then(() => {
    // Replit DB / pg 풀이 닫히지 않은 keep-alive 소켓을 잡아둘 수 있어
    // 일회성 CLI 가 한 줄을 찍자마자 깔끔히 종료되도록 명시적으로 빠져나간다.
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[ack-banner-stats] 실패:', err);
    try {
      await db.disconnect();
    } catch {}
    process.exit(1);
  });
