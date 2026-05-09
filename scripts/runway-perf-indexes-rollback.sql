-- Roll back indexes added by scripts/runway-perf-indexes.sql.
-- Run outside a transaction.
SET lock_timeout = '2s';
SET statement_timeout = '10min';

DROP INDEX CONCURRENTLY IF EXISTS idx_runway_jobs_user_status_created_at_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_runway_jobs_status_priority_created_at_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_runway_jobs_user_created_at_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_runway_jobs_completed_finished_at_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_runway_jobs_user_remark_created_at_desc;
