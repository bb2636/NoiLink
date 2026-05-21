-- ============================================================================
-- NoiLink 정규화 스키마 (Task #157)
-- ----------------------------------------------------------------------------
-- 이 파일은 PostgresDB.initTables() 가 부팅 시 한 번 자동 실행한다.
-- 모든 CREATE 는 IF NOT EXISTS — 멱등 보장.
--
-- 정책:
-- - 핵심 entity (users, sessions, passwords, organizations, terms) 는 컬럼으로 평탄화.
-- - 부가 entity (metrics_scores, raw_metrics, reports, rankings,
--   org_insight_reports, daily_*, ble_*_events, ack_*_events, inquiries) 는
--   조회 키만 컬럼으로 빼고 나머지는 payload JSONB 로 보관.
-- - kv_store 는 idempotency / normConfig / migrations 같은 진짜 KV 용도로 유지.
-- ============================================================================

-- KV 호환 store (마이그레이션·idempotency·normConfig 전용)
CREATE TABLE IF NOT EXISTS kv_store (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kv_key ON kv_store(key);

-- ============================================================================
-- 1. users / passwords / organizations / terms (핵심 entity, 평탄화)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id                          VARCHAR(64) PRIMARY KEY,
  username                    VARCHAR(255) NOT NULL,
  email                       VARCHAR(255),
  name                        VARCHAR(255) NOT NULL,
  nickname                    VARCHAR(255),
  phone                       VARCHAR(64),
  age                         INTEGER,
  user_type                   VARCHAR(32) NOT NULL,
  organization_id             VARCHAR(64),
  device_id                   VARCHAR(255),
  brainimal_type              VARCHAR(64),
  brainimal_confidence        REAL,
  brain_age                   INTEGER,
  previous_brain_age          INTEGER,
  streak                      INTEGER NOT NULL DEFAULT 0,
  best_streak                 INTEGER,
  last_training_date          TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at               TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ,
  is_deleted                  BOOLEAN DEFAULT FALSE,
  organization_name           VARCHAR(255),
  approval_status             VARCHAR(32),
  documents                   JSONB,
  pending_organization_id     VARCHAR(64),
  pending_organization_name   VARCHAR(255),
  pending_requested_at        TIMESTAMPTZ,
  social_provider             VARCHAR(32),
  social_id                   VARCHAR(255),
  extra                       JSONB
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_social ON users(social_provider, social_id);
CREATE INDEX IF NOT EXISTS idx_users_is_deleted ON users(is_deleted);
-- 중복 가입 방지 — email/username 이 NULL 또는 빈 문자열이면 허용, 값이 있으면 유일.
-- (소셜 가입 등 email 없는 케이스를 깨지 않기 위해 partial unique index 사용.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email
  ON users(email) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_username
  ON users(username) WHERE username IS NOT NULL AND username <> '';

CREATE TABLE IF NOT EXISTS passwords (
  user_id        VARCHAR(64) PRIMARY KEY,
  email          VARCHAR(255),
  password_hash  TEXT NOT NULL,
  must_change    BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_passwords_email ON passwords(email);

CREATE TABLE IF NOT EXISTS organizations (
  id                VARCHAR(64) PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  admin_user_id     VARCHAR(64),
  member_user_ids   JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ,
  extra             JSONB
);
CREATE INDEX IF NOT EXISTS idx_organizations_admin ON organizations(admin_user_id);

CREATE TABLE IF NOT EXISTS terms (
  id           VARCHAR(64) PRIMARY KEY,
  type         VARCHAR(32) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  content      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  is_required  BOOLEAN DEFAULT TRUE,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ,
  created_by   VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_terms_type_active ON terms(type, is_active);

-- ============================================================================
-- 2. sessions (트레이닝 세션) + metrics_scores + raw_metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id             VARCHAR(64) PRIMARY KEY,
  user_id        VARCHAR(64) NOT NULL,
  mode           VARCHAR(32) NOT NULL,
  bpm            INTEGER NOT NULL,
  level          INTEGER NOT NULL,
  duration       INTEGER NOT NULL,
  score          INTEGER,
  is_composite   BOOLEAN NOT NULL DEFAULT FALSE,
  is_valid       BOOLEAN NOT NULL DEFAULT TRUE,
  phases         JSONB,
  meta           JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_composite ON sessions(user_id, is_composite, is_valid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);

CREATE TABLE IF NOT EXISTS metrics_scores (
  session_id     VARCHAR(64) PRIMARY KEY,
  user_id        VARCHAR(64) NOT NULL,
  memory         REAL,
  comprehension  REAL,
  focus          REAL,
  judgment       REAL,
  agility        REAL,
  endurance      REAL,
  rhythm         REAL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_metrics_scores_user ON metrics_scores(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS raw_metrics (
  session_id        VARCHAR(64) PRIMARY KEY,
  user_id           VARCHAR(64) NOT NULL,
  touch_count       INTEGER,
  hit_count         INTEGER,
  rt_mean           REAL,
  rt_sd             REAL,
  by_mode_metrics   JSONB,
  rhythm            JSONB,
  memory            JSONB,
  comprehension     JSONB,
  focus             JSONB,
  judgment          JSONB,
  agility           JSONB,
  endurance         JSONB,
  recovery          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_raw_metrics_user ON raw_metrics(user_id, created_at DESC);

-- ============================================================================
-- 3. rankings / reports / org_insight_reports
-- ============================================================================

CREATE TABLE IF NOT EXISTS rankings (
  id               VARCHAR(96) PRIMARY KEY,
  user_id          VARCHAR(64),
  organization_id  VARCHAR(64),
  ranking_type     VARCHAR(32),
  score            REAL,
  rank             INTEGER,
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rankings_type ON rankings(ranking_type);
CREATE INDEX IF NOT EXISTS idx_rankings_user ON rankings(user_id);
CREATE INDEX IF NOT EXISTS idx_rankings_org ON rankings(organization_id);

CREATE TABLE IF NOT EXISTS reports (
  id              VARCHAR(96) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  report_version  INTEGER,
  brainimal_type  VARCHAR(64),
  confidence      INTEGER,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS org_insight_reports (
  id               VARCHAR(96) PRIMARY KEY,
  organization_id  VARCHAR(64) NOT NULL,
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_insight_reports_org_created ON org_insight_reports(organization_id, created_at DESC);

-- ============================================================================
-- 4. 일일 컨디션 / 미션
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_conditions (
  user_id        VARCHAR(64) NOT NULL,
  date           VARCHAR(10) NOT NULL,
  payload        JSONB NOT NULL,
  calculated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_conditions_date ON daily_conditions(date);

CREATE TABLE IF NOT EXISTS daily_missions (
  user_id     VARCHAR(64) NOT NULL,
  date        VARCHAR(10) NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_missions_date ON daily_missions(date);

-- ============================================================================
-- 5. BLE 텔레메트리 / 문의
-- ============================================================================

CREATE TABLE IF NOT EXISTS ble_abort_events (
  id          VARCHAR(96) PRIMARY KEY,
  user_id     VARCHAR(64),
  session_id  VARCHAR(64),
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ble_abort_user_created ON ble_abort_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ack_banner_events (
  id          VARCHAR(96) PRIMARY KEY,
  user_id     VARCHAR(64),
  session_id  VARCHAR(64),
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ack_banner_user_created ON ack_banner_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inquiries (
  id          VARCHAR(96) PRIMARY KEY,
  user_id     VARCHAR(64),
  session_id  VARCHAR(64),
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- inquiries 테이블에 session_id 컬럼이 누락된 기존 DB 도 보정 (멱등)
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_inquiries_user_created ON inquiries(user_id, created_at DESC);
