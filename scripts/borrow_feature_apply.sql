-- Borrowed compute feature apply script
-- Created: 20260509-201953
-- Safe to rerun. Feature flags default to OFF in Redis; this only adds schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS borrow_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(128) NOT NULL UNIQUE,
  endpoint text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 0,
  max_inflight integer NOT NULL DEFAULT 2,
  accepted_models text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE borrow_systems DROP COLUMN IF EXISTS api_key;

CREATE TABLE IF NOT EXISTS borrow_capacity_reports (
  system_id uuid PRIMARY KEY REFERENCES borrow_systems(id) ON DELETE CASCADE,
  reported_at timestamptz NOT NULL DEFAULT now(),
  local_pending integer NOT NULL DEFAULT 0,
  local_active integer NOT NULL DEFAULT 0,
  free_slots integer NOT NULL DEFAULT 0,
  available_slots integer NOT NULL DEFAULT 0,
  cooldown_accounts integer NOT NULL DEFAULT 0,
  recent_429 integer NOT NULL DEFAULT 0,
  failure_rate numeric(6,4) NOT NULL DEFAULT 0,
  avg_duration_seconds integer,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS borrow_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runway_job_id uuid NOT NULL REFERENCES runway_jobs(id) ON DELETE CASCADE,
  system_id uuid REFERENCES borrow_systems(id) ON DELETE SET NULL,
  system_name varchar(128),
  shadow_job_id text,
  status varchar(32) NOT NULL DEFAULT 'dispatching',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_url text,
  thumbnail_url text,
  video_url text,
  error_code varchar(64),
  error_message text,
  attempt integer NOT NULL DEFAULT 1,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE runway_jobs ADD COLUMN IF NOT EXISTS execution_mode varchar(16) NOT NULL DEFAULT 'local';
ALTER TABLE runway_jobs ADD COLUMN IF NOT EXISTS borrow_dispatch_id uuid;
ALTER TABLE runway_jobs ADD COLUMN IF NOT EXISTS borrow_system_id uuid;
ALTER TABLE runway_jobs ADD COLUMN IF NOT EXISTS borrow_system_name varchar(128);
ALTER TABLE runway_jobs ADD COLUMN IF NOT EXISTS borrow_status varchar(32);
ALTER TABLE runway_jobs ADD COLUMN IF NOT EXISTS borrow_error_code varchar(64);

CREATE INDEX IF NOT EXISTS idx_borrow_systems_enabled_priority ON borrow_systems(enabled, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_borrow_dispatches_status ON borrow_dispatches(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_dispatches_system_status ON borrow_dispatches(system_id, status);
CREATE INDEX IF NOT EXISTS idx_borrow_dispatches_runway_job ON borrow_dispatches(runway_job_id);
CREATE INDEX IF NOT EXISTS idx_runway_jobs_execution_mode ON runway_jobs(execution_mode);
CREATE INDEX IF NOT EXISTS idx_runway_jobs_borrow_dispatch_id ON runway_jobs(borrow_dispatch_id);
CREATE INDEX IF NOT EXISTS idx_runway_jobs_provider_status ON runway_jobs(provider, status);
