-- Borrowed compute feature rollback script
-- Created: 20260509-201953
-- Run Redis disable first or immediately after this SQL:
-- redis-cli mset borrow:dispatch:enabled 0 borrow:provider:enabled 0

UPDATE runway_jobs
SET status = 'pending',
    execution_mode = 'local',
    borrow_dispatch_id = NULL,
    borrow_system_id = NULL,
    borrow_system_name = NULL,
    borrow_status = NULL,
    borrow_error_code = NULL,
    updated_at = now()
WHERE execution_mode = 'borrowed'
  AND status IN ('pending','queued','submitted','processing');

UPDATE runway_jobs
SET status = 'deleted',
    finished_at = COALESCE(finished_at, now()),
    error_message = COALESCE(error_message, 'borrow rollback hidden shadow job'),
    updated_at = now()
WHERE provider = 'borrowed'
  AND status NOT IN ('deleted');

DROP TABLE IF EXISTS borrow_capacity_reports;
DROP TABLE IF EXISTS borrow_dispatches;
DROP TABLE IF EXISTS borrow_systems;

DROP INDEX IF EXISTS idx_runway_jobs_execution_mode;
DROP INDEX IF EXISTS idx_runway_jobs_borrow_dispatch_id;
DROP INDEX IF EXISTS idx_runway_jobs_provider_status;

ALTER TABLE runway_jobs DROP COLUMN IF EXISTS borrow_error_code;
ALTER TABLE runway_jobs DROP COLUMN IF EXISTS borrow_status;
ALTER TABLE runway_jobs DROP COLUMN IF EXISTS borrow_system_name;
ALTER TABLE runway_jobs DROP COLUMN IF EXISTS borrow_system_id;
ALTER TABLE runway_jobs DROP COLUMN IF EXISTS borrow_dispatch_id;
ALTER TABLE runway_jobs DROP COLUMN IF EXISTS execution_mode;
