#!/bin/bash
# 머지 후 자동 실행: 의존성 동기화 + shared 빌드
# - 멱등(idempotent), 비대화형(non-interactive)
# - shared는 client/server가 컴파일된 산출물을 import 하므로 매번 다시 빌드한다.

set -e

echo "[post-merge] npm install (workspaces)"
npm install --no-audit --no-fund --no-progress

echo "[post-merge] build shared"
npm run build:shared

# shared 패키지가 ESM 으로 정상 해석되는지 정적 import 스모크 체크.
# (회귀 사례: shared/package.json 에 "type": "module" 이 빠지면 dist/*.js 가
#  CJS 로 잘못 해석돼서 'does not provide an export named ...' 로 서버가 부팅
#  단계에서 죽는다 — 동적 import 만으로는 잡히지 않으므로 정적 import 로 검증.)
echo "[post-merge] smoke check @noilink/shared ESM exports"
node --input-type=module -e "import { KST_TIME_ZONE, COMPOSITE_TOTAL_MS, sanitizeRecoveryRawMetrics } from '@noilink/shared'; if (typeof KST_TIME_ZONE !== 'string' || typeof COMPOSITE_TOTAL_MS !== 'number' || typeof sanitizeRecoveryRawMetrics !== 'function') { console.error('shared smoke check FAILED — named exports not resolvable. Hint: shared/package.json 의 \"type\": \"module\" 누락 또는 dist 미빌드 가능성을 먼저 확인하세요.'); process.exit(1); }"

echo "[post-merge] done"
