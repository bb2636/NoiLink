# NoiLink - 뇌지컬 트레이닝

A mobile-optimized web application for cognitive ability training and analysis.

## Overview

NoiLink measures six cognitive indicators (memory, comprehension, concentration, judgment, agility, endurance), analyzes the user's "Brainimal" (Brain + Animal) type, and provides customized training reports.

## Architecture

This is an **npm monorepo** with three workspaces:

- `client/` — React 18 + Vite frontend (port 5000)
- `server/` — Express.js backend API (port 3001)
- `shared/` — Shared TypeScript types

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router v6
- **Backend**: Node.js, Express.js, TypeScript (tsx)
- **Database**: Auto-selects: PostgreSQL (if DATABASE_URL set), Replit Database (if REPL_ID set), or local JSON fallback
- **Auth**: JWT tokens with bcryptjs password hashing

## Development

```bash
npm run dev        # Runs both frontend (port 5000) and backend (port 3001) concurrently
npm run build      # Build all workspaces (shared → client → server)
```

The shared package must be built before the client:
```bash
cd shared && npm run build
```

## Configuration

- Frontend proxies `/api` requests to `http://localhost:3001`
- Vite configured with `host: '0.0.0.0'`, `allowedHosts: true` for Replit proxy compatibility
- Backend port: 3001 (set via `PORT` env var)

## Environment Variables

- `JWT_SECRET` — Required in production. Auto-generated for dev.
- `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Admin seed credentials. In production, `ADMIN_PASSWORD` must be set or seeding is skipped.
- `DB_TYPE` — Explicit DB selection: `postgres`, `replit`, or `local`
- `DATABASE_URL` — PostgreSQL connection string

## Database

Auto-detection priority:
1. `DB_TYPE` env var explicitly set
2. `DATABASE_URL` → PostgreSQL
3. `REPLIT_DB_URL` or `REPL_ID` → Replit Database
4. Fallback → Local JSON file at `server/data/`

## Security

- Passwords hashed with bcryptjs (backward-compatible with legacy plaintext)
- JWT secret enforced via environment variable in production
- Auth middleware protects user update endpoints (self-or-admin only)
- x-user-id header bypass removed

## Admin Account

Default admin: `admin@admin.com` / `admin1234` (dev only, skipped in production without `ADMIN_PASSWORD`)

## Hardware Protocol (NoiPod BLE)

- 정본 코드: `shared/ble-protocol.ts` (LED / SESSION / CONTROL / TOUCH 인코딩)
- LED 즉시 소등 컨벤션 (펌웨어 합의서): `docs/firmware/led-off-convention.md`
  - 색=0xFF 또는 onMs=0 → 펌웨어가 잔여 onMs 무시하고 LED 즉시 OFF
  - 펌웨어 측 구현·릴리스 노트 반영 필요 (별도 리포지토리)

## Deployment

- Target: autoscale
- Build: `npm run build` (builds shared → client → server)
- Run: `cd server && npm start` (serves built Express app + static client files)
- Server auto-detects built vs dev mode for correct `client/dist` path resolution
