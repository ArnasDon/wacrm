-- ============================================================
-- 038_eter_agent_pending_actions.sql — write-gate table for the EterWA
-- agent + a small extension to `notifications.type`.
--
-- Design notes
--   - `agent_pending_actions` is the persistence half of the write gate
--     described in src/lib/ai/tools/write-gate.ts: the model may only
--     *propose* a calendar-mutating tool call (book_meeting, reschedule,
--     cancel_booking) — the handler for those tools writes a row here
--     instead of touching Google Calendar / `bookings` directly. The
--     mutation only actually happens when product code calls
--     `confirmPendingAction()` after detecting the lead's explicit
--     confirmation in a later message. This is a mechanism, not a
--     prompt instruction — the tool handler is *structurally* unable to
--     perform the write, regardless of what the model believes it did.
--   - `tool_name` is constrained to exactly the three write tools —
--     nothing else should ever end up here.
--   - `tool_input` is the raw JSON-Schema-validated arguments the model
--     supplied (already parsed/typed on the way in); kept verbatim so
--     `confirmPendingAction` doesn't need the model to repeat itself.
--   - `status` starts 'pending' and is terminal once it becomes
--     'confirmed' / 'rejected' / 'expired' — enforced app-side (not by
--     a DB trigger, to keep this migration additive and simple); the
--     partial unique index below still guarantees at most one *pending*
--     proposal per conversation at a time, so a lead can't stack up
--     multiple ambiguous "which one did you mean?" proposals.
--   - RLS mirrors `bookings` / `lead_qualification` (migration 037):
--     operational-class, any account member may read/write, since this
--     is working data produced by the agent. The tool-executor path
--     runs under the service-role client, same as everywhere else in
--     this domain.
--
-- Also extends `notifications.type`'s CHECK constraint (migration 027)
-- with 'agent_notification', the type the notify_admin tool uses to
-- alert a human without pretending to be a conversation-assignment
-- event. Postgres has no `ALTER CHECK`, so this drops and recreates the
-- constraint by name — additive, existing 'conversation_assigned' rows
-- are unaffected.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE agent_pending_action_status AS ENUM ('pending', 'confirmed', 'rejected', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_pending_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  tool_name        text NOT NULL CHECK (tool_name IN ('book_meeting', 'reschedule', 'cancel_booking')),
  tool_input       jsonb NOT NULL,
  status           agent_pending_action_status NOT NULL DEFAULT 'pending',
  -- Populated once status leaves 'pending'; NULL while pending.
  resolved_at      timestamptz,
  -- The booking this proposal resolved into, once confirmed (for
  -- book_meeting: the newly created row; for reschedule/cancel: the
  -- existing booking that was mutated). Kept for audit/debugging.
  resulting_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_pending_actions_account_id_idx ON agent_pending_actions (account_id);
CREATE INDEX IF NOT EXISTS agent_pending_actions_conversation_id_idx ON agent_pending_actions (conversation_id);

-- At most one *pending* proposal per conversation — a new proposal must
-- resolve (confirm/reject/expire) the previous one first, so the agent
-- can't silently accumulate ambiguous proposals for the same thread.
CREATE UNIQUE INDEX IF NOT EXISTS agent_pending_actions_one_pending_per_conversation
  ON agent_pending_actions (conversation_id)
  WHERE status = 'pending' AND conversation_id IS NOT NULL;

ALTER TABLE agent_pending_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_pending_actions_select ON agent_pending_actions;
CREATE POLICY agent_pending_actions_select ON agent_pending_actions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agent_pending_actions_insert ON agent_pending_actions;
CREATE POLICY agent_pending_actions_insert ON agent_pending_actions FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS agent_pending_actions_update ON agent_pending_actions;
CREATE POLICY agent_pending_actions_update ON agent_pending_actions FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agent_pending_actions_delete ON agent_pending_actions;
CREATE POLICY agent_pending_actions_delete ON agent_pending_actions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_agent_pending_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_pending_actions_updated_at ON agent_pending_actions;
CREATE TRIGGER agent_pending_actions_updated_at
  BEFORE UPDATE ON agent_pending_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_agent_pending_actions_updated_at();

-- ============================================================
-- notifications.type — add 'agent_notification' for notify_admin.
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'agent_notification'));
