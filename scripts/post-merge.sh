#!/bin/bash
# 머지 후 자동 실행: 의존성 동기화 + shared 빌드
# - 멱등(idempotent), 비대화형(non-interactive)
# - shared는 client/server가 컴파일된 산출물을 import 하므로 매번 다시 빌드한다.

set -e

echo "[post-merge] npm install (workspaces)"
npm install --no-audit --no-fund --no-progress

echo "[post-merge] build shared"
npm run build:shared

echo "[post-merge] done"
