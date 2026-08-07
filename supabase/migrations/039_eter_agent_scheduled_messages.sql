-- ============================================================
-- 039_eter_agent_scheduled_messages.sql — deferred WhatsApp sends for
-- the EterWA agent: quiet-lead follow-ups + meeting reminders.
--
-- Design notes
--   - `agent_scheduled_messages` is a small delivery queue modelled
--     after `automation_pending_executions` (migration 011-ish, see
--     src/lib/automations/engine.ts `resumePendingExecution`) — a row
--     is inserted with a future `send_at`, and a cron endpoint
--     (`/api/eter-agent/cron`, same `x-cron-secret` auth pattern as
--     `/api/automations/cron` and `/api/flows/cron`) drains whatever
--     is due. It is deliberately a NEW table rather than a reuse of
--     `automation_pending_executions` — that table's rows carry
--     step-resumption semantics owned by the automations engine
--     (next_step_position, branch, parent_step_id); this queue only
--     ever means "send this WhatsApp message at this time", so
--     folding the two together would force one of the two owners to
--     understand the other's columns.
--   - `kind` distinguishes the two features this migration supports:
--       follow_up_1d / follow_up_3d / follow_up_7d — the quiet-lead
--         cadence for a `lead_qualification.stage = 'morno'` contact
--         whose conversation has gone quiet (T+1/T+3/T+7 days).
--       reminder_24h / reminder_2h — meeting reminders scheduled
--         relative to a confirmed `bookings.starts_at` (what makes the
--         `send_reminder` agent tool actually do something instead of
--         returning the "not implemented" stub it shipped as).
--   - `status` includes a `processing` value (not just
--     pending/sent/cancelled/failed) — mirrors the two-step
--     UPDATE-by-id claim `/api/automations/cron` already uses
--     (status='pending' -> 'processing' via a conditional UPDATE)
--     so overlapping cron invocations can't double-send the same
--     row. A bare pending->sent flip would leave no way to tell "a
--     concurrent invocation is mid-send" from "never attempted".
--   - `payload` carries whatever the sender needs at send time that
--     isn't already implied by `kind`/`booking_id` — e.g. the
--     pre-generated free-text copy for the in-window case. The
--     template used for the out-of-window case is NOT stored here;
--     it's looked up by naming convention
--     (`eter_<kind>`, e.g. `eter_follow_up_1d`) against
--     `message_templates` at send time, so a template can be
--     re-approved/edited without touching already-queued rows.
--   - Two partial unique indexes keep scheduling idempotent:
--     at most one *pending* follow-up of a given kind per
--     conversation, and at most one *pending* reminder of a given
--     kind per booking. Callers (followups.ts) cancel-then-insert
--     rather than relying on upsert, but the indexes are the actual
--     invariant guarantee, same spirit as
--     `agent_pending_actions_one_pending_per_conversation` (038).
--   - RLS mirrors `bookings` / `lead_qualification` (037) /
--     `agent_pending_actions` (038): operational-class, any account
--     member may read/write; the cron route runs under the
--     service-role client (no RLS) same as everywhere else in this
--     domain.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE agent_scheduled_message_kind AS ENUM (
    'follow_up_1d',
    'follow_up_3d',
    'follow_up_7d',
    'reminder_24h',
    'reminder_2h'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_scheduled_message_status AS ENUM ('pending', 'processing', 'sent', 'cancelled', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_scheduled_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Only populated for reminder_24h / reminder_2h. Follow-ups are
  -- conversation-scoped, not tied to a specific booking.
  booking_id       uuid REFERENCES bookings(id) ON DELETE CASCADE,
  kind             agent_scheduled_message_kind NOT NULL,
  send_at          timestamptz NOT NULL,
  status           agent_scheduled_message_status NOT NULL DEFAULT 'pending',
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set on a 'failed' row so an operator (or a future retry job) knows
  -- why without re-deriving it — e.g. "no approved template
  -- eter_follow_up_3d for account X and the 24h window had closed".
  error            text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_scheduled_messages_account_id_idx ON agent_scheduled_messages (account_id);
CREATE INDEX IF NOT EXISTS agent_scheduled_messages_conversation_id_idx ON agent_scheduled_messages (conversation_id);
CREATE INDEX IF NOT EXISTS agent_scheduled_messages_booking_id_idx ON agent_scheduled_messages (booking_id);
-- The cron sweep scans exactly this shape: due, still-pending rows,
-- oldest first.
CREATE INDEX IF NOT EXISTS agent_scheduled_messages_due_idx
  ON agent_scheduled_messages (send_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS agent_scheduled_messages_one_pending_followup_per_kind
  ON agent_scheduled_messages (conversation_id, kind)
  WHERE status = 'pending'
    AND conversation_id IS NOT NULL
    AND kind IN ('follow_up_1d', 'follow_up_3d', 'follow_up_7d');

CREATE UNIQUE INDEX IF NOT EXISTS agent_scheduled_messages_one_pending_reminder_per_kind
  ON agent_scheduled_messages (booking_id, kind)
  WHERE status = 'pending'
    AND booking_id IS NOT NULL
    AND kind IN ('reminder_24h', 'reminder_2h');

ALTER TABLE agent_scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_scheduled_messages_select ON agent_scheduled_messages;
CREATE POLICY agent_scheduled_messages_select ON agent_scheduled_messages FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agent_scheduled_messages_insert ON agent_scheduled_messages;
CREATE POLICY agent_scheduled_messages_insert ON agent_scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS agent_scheduled_messages_update ON agent_scheduled_messages;
CREATE POLICY agent_scheduled_messages_update ON agent_scheduled_messages FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agent_scheduled_messages_delete ON agent_scheduled_messages;
CREATE POLICY agent_scheduled_messages_delete ON agent_scheduled_messages FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_agent_scheduled_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_scheduled_messages_updated_at ON agent_scheduled_messages;
CREATE TRIGGER agent_scheduled_messages_updated_at
  BEFORE UPDATE ON agent_scheduled_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_agent_scheduled_messages_updated_at();
