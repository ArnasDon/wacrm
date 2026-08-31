-- ============================================================
-- 097_tasks.sql — follow-up tasks (starting on Contacts)
--
-- A task is a to-do a teammate owns: "call tomorrow", "send the
-- quote by Friday". Optionally tied to a contact and/or a deal.
-- When it has a `due_at` and an `assigned_to`, the reminder cron
-- (/api/tasks/reminders/cron) inserts a `notifications` row for the
-- assignee once it comes due — and the existing migration-095
-- fan-out trigger turns that into a Web Push automatically.
--
-- RLS: any account member reads the account's tasks; agent+ writes
-- (mirrors quick_replies / products tiering). `created_by` / status
-- transitions are not otherwise restricted — a small team shares a
-- task list.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  completed_at TIMESTAMPTZ,
  -- Set by the reminder cron the first time a due task is pushed, so
  -- the assignee is nudged once, not every sweep.
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_account_status_due
  ON public.tasks(account_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON public.tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON public.tasks(assigned_to);
-- The reminder cron's working set: open, due, not yet nudged.
CREATE INDEX IF NOT EXISTS idx_tasks_due_reminder
  ON public.tasks(due_at)
  WHERE status = 'open' AND reminder_sent_at IS NULL AND assigned_to IS NOT NULL;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

CREATE POLICY tasks_select ON public.tasks FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND created_by = auth.uid());
CREATE POLICY tasks_update ON public.tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_delete ON public.tasks FOR DELETE
  USING (is_account_member(account_id, 'agent'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

-- ------------------------------------------------------------
-- notifications: allow the 'task_due' type the reminder cron inserts.
-- Keep every existing value (migration 095's set).
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'ai_key_invalid',
    'google_calendar_error',
    'google_sheets_error',
    'task_due'
  ));

-- ------------------------------------------------------------
-- Schedule the reminder sweep (pg_cron). SECRET NOT COMMITTED —
-- run this block separately with the real values, or reuse the
-- x-cron-secret already baked into an existing cron.job. Applied
-- to prod 2026-08-30 via a DO block that recovered the secret
-- from cron.job (no secret in transit), same as migrations
-- 089 / 092 / 095.
--
--   select cron.schedule('task-reminders-sweep', '*/5 * * * *', $q$
--     select net.http_post(
--       url := 'https://REPLACE_ME/api/tasks/reminders/cron',
--       headers := jsonb_build_object('x-cron-secret', 'REPLACE_ME_WEBHOOK_CRON_SECRET')
--     ) $q$);
-- ------------------------------------------------------------
