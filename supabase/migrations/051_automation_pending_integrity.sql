ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS parked_step_id UUID;

CREATE INDEX IF NOT EXISTS idx_automation_pending_stalled
  ON automation_pending_executions(claimed_at)
  WHERE status = 'running';
