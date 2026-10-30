-- ============================================================
-- 061_conversation_followups.sql — dated follow-up reminders
--
-- An agent sets a follow-up date on a conversation ("call me back on
-- 12 Nov", "policy renewal window opens 20 Dec"). WACRM then drops an
-- in-app notification (the Notifications page / bell) ONE DAY BEFORE
-- and ON the date, and the app sends a Web Push for each one.
--
-- Additive + idempotent: one new table, one function, and the
-- notifications.type CHECK is widened (existing rows stay valid).
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_followups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id      uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id           uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Who gets the reminders (the agent who set it).
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_date             date NOT NULL,
  note                 text,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'done')),
  remind_day_before_at timestamptz,   -- set once the "tomorrow" reminder is created
  remind_due_at        timestamptz,   -- set once the "due today" reminder is created
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_followups_due_idx
  ON conversation_followups (status, due_date);
CREATE INDEX IF NOT EXISTS conversation_followups_account_idx
  ON conversation_followups (account_id, status, due_date);
CREATE INDEX IF NOT EXISTS conversation_followups_conversation_idx
  ON conversation_followups (conversation_id);

ALTER TABLE conversation_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_followups_select ON conversation_followups;
CREATE POLICY conversation_followups_select ON conversation_followups FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS conversation_followups_insert ON conversation_followups;
CREATE POLICY conversation_followups_insert ON conversation_followups FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

-- Teammates may complete / reschedule each other's follow-ups.
DROP POLICY IF EXISTS conversation_followups_update ON conversation_followups;
CREATE POLICY conversation_followups_update ON conversation_followups FOR UPDATE
  USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS conversation_followups_delete ON conversation_followups;
CREATE POLICY conversation_followups_delete ON conversation_followups FOR DELETE
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- Allow the new notification type (was: 'conversation_assigned' only).
-- ------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%conversation_assigned%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'follow_up_due'));

-- ------------------------------------------------------------
-- Reminder generator. Safe to call as often as you like: each
-- reminder is created exactly once (flags are set in the same
-- statement), and it does nothing before `p_min_hour` local time so
-- nobody is buzzed at midnight.
--
--   * due TOMORROW  -> "Follow-up tomorrow"
--   * due TODAY (or overdue, if the scheduler was down) -> "Follow-up due today"
--
-- Returns the notifications it just created so the app can push them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_followup_reminders(
  p_tz text DEFAULT 'Asia/Kolkata',
  p_min_hour int DEFAULT 9
)
RETURNS TABLE (
  out_notification_id uuid,
  out_account_id uuid,
  out_user_id uuid,
  out_conversation_id uuid,
  out_kind text,
  out_title text,
  out_body text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local timestamp := (now() AT TIME ZONE p_tz);
  v_today date := (now() AT TIME ZONE p_tz)::date;
BEGIN
  IF extract(hour FROM v_local) < p_min_hour THEN
    RETURN;
  END IF;

  -- 1) Day-before reminders
  RETURN QUERY
  WITH claimed AS (
    UPDATE conversation_followups f
       SET remind_day_before_at = now(), updated_at = now()
     WHERE f.id IN (
       SELECT x.id FROM conversation_followups x
        WHERE x.status = 'pending'
          AND x.due_date = v_today + 1
          AND x.remind_day_before_at IS NULL
          FOR UPDATE SKIP LOCKED
     )
    RETURNING f.*
  ), ins AS (
    INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id, title, body)
    SELECT c.account_id, c.user_id, 'follow_up_due', c.conversation_id, c.contact_id,
           'Follow-up tomorrow: ' || COALESCE(NULLIF(ct.name, ''), ct.phone, 'customer'),
           COALESCE(NULLIF(c.note, ''), 'Follow up with this customer')
             || ' (due ' || to_char(c.due_date, 'DD Mon YYYY') || ')'
      FROM claimed c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
    RETURNING id, account_id, user_id, conversation_id, title, body
  )
  SELECT i.id, i.account_id, i.user_id, i.conversation_id, 'tomorrow'::text, i.title, i.body
    FROM ins i;

  -- 2) Due-today (or overdue) reminders
  RETURN QUERY
  WITH claimed AS (
    UPDATE conversation_followups f
       SET remind_due_at = now(), updated_at = now()
     WHERE f.id IN (
       SELECT x.id FROM conversation_followups x
        WHERE x.status = 'pending'
          AND x.due_date <= v_today
          AND x.remind_due_at IS NULL
          FOR UPDATE SKIP LOCKED
     )
    RETURNING f.*
  ), ins AS (
    INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id, title, body)
    SELECT c.account_id, c.user_id, 'follow_up_due', c.conversation_id, c.contact_id,
           CASE WHEN c.due_date < v_today THEN 'Follow-up overdue: ' ELSE 'Follow-up due today: ' END
             || COALESCE(NULLIF(ct.name, ''), ct.phone, 'customer'),
           COALESCE(NULLIF(c.note, ''), 'Follow up with this customer')
             || ' (due ' || to_char(c.due_date, 'DD Mon YYYY') || ')'
      FROM claimed c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
    RETURNING id, account_id, user_id, conversation_id, title, body
  )
  SELECT i.id, i.account_id, i.user_id, i.conversation_id, 'due'::text, i.title, i.body
    FROM ins i;
END;
$$;

-- Only the server (service role) may run the generator.
REVOKE ALL ON FUNCTION process_followup_reminders(text, int) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION process_followup_reminders(text, int) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION process_followup_reminders(text, int) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION process_followup_reminders(text, int) TO service_role;
  END IF;
END $$;
