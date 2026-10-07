-- ============================================================
-- 045_automation_wait_for_reply
--
-- Lets a Send Buttons / Send List automation step park the run until
-- the customer replies. Before this, an automation ran every step in a
-- single pass, so an If/Else placed after a Send Buttons step was
-- evaluated against the message that STARTED the run ("Hii"), never
-- against the button the customer then tapped. The tap arrived as a
-- brand-new inbound with nothing waiting for it.
--
-- The parked run reuses `automation_pending_executions`, the queue the
-- time-based `wait` step already uses — it records exactly what a
-- resume needs (scope, next position, context). Three new statuses:
--
--   awaiting_reply  parked at a `wait_for_reply` step; the webhook
--                   resumes it with the contact's next inbound. For
--                   these rows `run_at` is the reply DEADLINE (24h,
--                   WhatsApp's customer-service window), not a due
--                   time — the cron's due-drain only ever reads
--                   `status = 'pending'`, so it never resumes them.
--   expired         the deadline passed with no reply (or the
--                   automation was paused while waiting).
--   superseded      a newer awaiting_reply run for the same contact
--                   replaced it — the newest menu wins.
--
-- The CHECK was declared inline in 006, so Postgres named it
-- `automation_pending_executions_status_check`.
-- ============================================================

ALTER TABLE automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;

ALTER TABLE automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN (
    'pending', 'running', 'done', 'failed',
    'awaiting_reply', 'expired', 'superseded'
  ));

-- The webhook looks up a contact's waiting run on every inbound
-- message, so keep that lookup indexed and tiny.
CREATE INDEX IF NOT EXISTS idx_automation_pending_awaiting_reply
  ON automation_pending_executions(account_id, contact_id)
  WHERE status = 'awaiting_reply';
