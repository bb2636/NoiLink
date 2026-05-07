# NoiLink - 뇌지컬 트레이닝

A mobile-optimized web application for cognitive ability training and analysis, analyzing "Brainimal" type and providing customized reports.

## Run & Operate

```bash
npm run dev        # Runs both frontend (port 5000) and backend (port 3001) concurrently
npm run build      # Build all workspaces (shared → client → server)
cd shared && npm run build # Must build shared before client
```

**Required Environment Variables:**
- `JWT_SECRET`: Required in production.
- `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`: Admin seed credentials. `ADMIN_PASSWORD` required for seeding in production.
- `DB_TYPE`: Explicitly selects DB (`postgres`, `replit`, or `local`).
- `DATABASE_URL`: PostgreSQL connection string.

**Database Auto-detection:**
1. `DB_TYPE` env var
2. `DATABASE_URL` → PostgreSQL
3. `REPLIT_DB_URL` or `REPL_ID` → Replit Database
4. Fallback → Local JSON file at `server/data/`

## Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router v6
- **Backend:** Node.js, Express.js, TypeScript (tsx)
- **Database:** PostgreSQL / Replit Database / Local JSON fallback
- **Auth:** JWT tokens, bcryptjs for password hashing
- **Build Tool:** npm monorepo (Vite for client)

## Where things live

- `client/`: React frontend application.
- `server/`: Express.js backend API.
- `shared/`: Shared TypeScript types and utilities (ESM-only).
- `shared/ble-protocol.ts`: Source of truth for BLE hardware protocol (LED, SESSION, CONTROL, TOUCH encoding).
- `shared/ble-stability-config.ts`: BLE stability remote configuration schema and defaults.
- `shared/kst-date.ts`: KST-based date utility functions, used for attendance and ranking.
- `docs/firmware/led-off-convention.md`: Firmware agreement for LED immediate turn-off.
- `docs/operations/ble-stability-threshold-tuning.md`: Guide for BLE disconnect threshold tuning.
- `docs/operations/ble-abort-telemetry.md`: BLE abort telemetry details.
- `docs/operations/ack-banner-telemetry.md`: ACK reject toast telemetry details.

## Architecture decisions

- **Idempotent Training Session Saves:** `POST /api/sessions`, `POST /api/metrics/calculate`, `POST /api/metrics/raw` endpoints support `Idempotency-Key` header to prevent duplicate training saves during network retries. The client generates a stable `localId` for this.
- **ESM-only Shared Package:** The `@noilink/shared` package is ESM-only (`"type": "module"`), enforcing `import` syntax to prevent runtime errors. A `post-merge.sh` script validates this.
- **Unified Ranking Source:** User ranking cards (`/api/rankings/user/:userId/card`) derive all 4 stats (compositeScore, totalTimeHours, streakDays, attendanceRate) from the same 14-day window and session data as the main ranking table (`/api/rankings`).
- **BLE Legacy Mode Toggle:** Supports both current NINA-B1 firmware (legacy mode, default ON) and future NoiPod specification (toggle OFF), with specific encoding/decoding logic for each. Includes a migration for users with old settings.
- **BLE Notify Parser Order (legacy):** `tryParseAnyNotifyBytes` classifies the 200ms notify stream in priority order: TOUCH (0xA5/0x81 11B) → IR (5B + 0x0D 0x0A) → NDEF Text (0xD1 0x01 …) → **raw ASCII fallback**. The current firmware delivers NFC tag text without an NDEF wrapper (e.g. `0x6C 0x65` = `"le"`), so the raw ASCII fallback is required for NFC input to register. `nfcTextToPod` then maps `"1".."4"` or `"left"/"right"/"up"/"down"` to pod 0..3.
- **KST-based Date Consistency:** All date-dependent calculations for result comparison, attendance, and rankings use KST (Korean Standard Time) helpers (`shared/kst-date.ts`) to ensure consistency regardless of client device timezones.
- **MEMORY Sequence Loop:** MEMORY phase repeats SHOW→RECALL cycles until phase time runs out. `runMemorySequence()` schedules one cycle; `advanceMemorySequence()` (idempotent via `memorySequenceAdvancing` flag) triggers the next on either RECALL window expiry or sequence completion/failure. `handleTap` skips the trailing `allOff()` while MEMORY RECALL is in progress so that subsequent inputs (BLE TOUCH / IR / NFC) of the same sequence are not blocked by the OFF guard.
- **Engine BLE Write Defense (Task #150):** All BLE writes from `client/src/training/engine.ts` (`bleWriteSession`/`bleWriteControl`/`bleWriteLed`) go through `safeBleWrite*` wrappers that swallow throws. Composite training failed (no LED + no input the whole 5min) when a single BLE throw inside `start()` aborted the path before `runNextPlan()` ran — `handleTap` then rejected every input on the OFF guard, masking the underlying BLE error as a "no input" symptom. `startTickLoop` also cancels any prior `tickTimer` before scheduling a new one to prevent overlapping fireTick loops on phase transitions.
- **BLE Diagnostic Line (Task #153):** Both `TrainingSessionPlay` and `Device` pages render a 1Hz-polled diagnostic line `BLE: FW=O/X/? · L=ON/OFF · 송신=N · <hex>` from `getBleFirmwareReady` / `getLegacyBleMode` / `getLegacyEmittedCount` / `getLegacyLastEmittedFrameHex`. Required because Task #150 `safeBleWrite*` wrappers swallow throws silently — without this line, "점등이 안 들어옴" reports have no user-visible signal to distinguish firmware-not-ready (FW=X → all writes skipped) from legacy-mode mismatch from engine-not-emitting from device-side ignore. Training screen also switched from `height: 100vh` to `100dvh` (with 100vh fallback) so the input counter is no longer pushed off-screen by mobile WebView address bar.
- **handleTap dedup scope (consumedTickIds):** Dedup of `(pod, tickId)` is applied **only when `opts.tickId` is explicitly provided** (i.e. BLE TOUCH 11B frames where the firmware echoes a tickId). NFC raw / IR vibration / unit-test calls have no `opts.tickId` and skip dedup entirely — otherwise sequences like MEMORY RECALL `[0,1,0]` (same Pod repeats while `pod.tickId` stays constant for the whole RECALL window) would silently drop the second hit on Pod 0, and JUDGMENT YELLOW double-taps would have the second tap rejected. Trade-off: NFC/IR has no engine-side native-redispatch protection, but the 200ms firmware polling cadence makes duplicate dispatch unlikely.

## Product

- Measures six cognitive indicators: memory, comprehension, concentration, judgment, agility, endurance.
- Analyzes user's "Brainimal" type based on cognitive profile.
- Provides customized training reports.
- Displays personal and organizational rankings.
- Offers enterprise insights for organizations.
- Supports cognitive training sessions with BLE hardware interaction.

## User preferences

_Populate as you build_

## Gotchas

- **Shared Package Builds:** Always run `cd shared && npm run build` before building the client or server to ensure the latest shared types are available.
- **BLE Write Serialization (Legacy Mode):** In legacy BLE mode, multiple rapid writes to the characteristic are serialized on the client-side (50ms gap) and native-side (30ms gap) to prevent firmware from dropping frames due to concurrent GATT writes.
- **Admin Password in Production:** `ADMIN_PASSWORD` must be explicitly set in production for seeding admin credentials; otherwise, seeding is skipped.
- **NoiPod vs. NINA-B1 Firmware:** The `legacyBleMode` toggle is critical for correct BLE communication depending on the connected hardware. Ensure it's set appropriately or verified on the Device screen.

## Pointers

- [React 18 Documentation](https://react.dev/blog/2022/03/29/react-v18)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Express.js Documentation](https://expressjs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Framer Motion Documentation](https://www.framer.com/motion/)
- [React Router v6 Documentation](https://reactrouter.com/en/v6)
- [Node.js Documentation](https://nodejs.org/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [JWT (JSON Web Tokens) Introduction](https://jwt.io/introduction/)
- [bcrypt.js GitHub](https://github.com/dcodeIO/bcrypt.js)