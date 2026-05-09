-- Runway task-list performance indexes.
-- Run each statement outside a transaction. CONCURRENTLY keeps reads/writes available.
SET lock_timeout = '2s';
SET statement_timeout = '30min';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runway_jobs_user_status_created_at_desc
  ON runway_jobs (user_id, status, created_at DESC)
  WHERE status <> 'deleted';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runway_jobs_status_priority_created_at_id
  ON runway_jobs (status, priority DESC, created_at ASC, id)
  WHERE status IN ('pending', 'queued', 'submitted', 'processing');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runway_jobs_user_created_at_desc
  ON runway_jobs (user_id, created_at DESC)
  WHERE status <> 'deleted';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runway_jobs_completed_finished_at_desc
  ON runway_jobs (finished_at DESC)
  WHERE status = 'completed';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runway_jobs_user_remark_created_at_desc
  ON runway_jobs (user_id, remark, created_at DESC)
  WHERE status <> 'deleted' AND remark IS NOT NULL;
