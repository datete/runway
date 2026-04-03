CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS runway_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID,
  provider         VARCHAR(32)  NOT NULL DEFAULT 'useapi',
  mode             VARCHAR(32)  NOT NULL,
  prompt           TEXT         NOT NULL,
  image_url        TEXT,
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending',
  remote_task_id   VARCHAR(128),
  explore_mode     BOOLEAN      NOT NULL DEFAULT TRUE,
  model_name       VARCHAR(64)  NOT NULL DEFAULT 'gen4',
  result_url       TEXT,
  thumbnail_url    TEXT,
  error_message    TEXT,
  retry_count      INT          NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS runway_job_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES runway_jobs(id) ON DELETE CASCADE,
  event_type   VARCHAR(32) NOT NULL,
  message      TEXT,
  payload_json JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runway_jobs_status ON runway_jobs(status);
CREATE INDEX IF NOT EXISTS idx_runway_jobs_user_id ON runway_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_runway_job_events_job_id ON runway_job_events(job_id);
