-- ============================================================
-- 041_data_deletion_requests.sql, RGPD data-deletion requests
-- triggered by a lead sending the exact word "APAGAR" on WhatsApp.
--
-- Design notes
--   - This table is a request queue for the OPERATIONS team, not an
--     automatic eraser. Nothing in this migration or the code that
--     writes to this table deletes a single row of contact/message
--     data, a human resolves the request (see `status`) once the
--     data has actually been removed. That is a deliberate scope cut
--     asked for by the product owner: the exact-match trigger is
--     easy to get wrong (a false positive would destroy data with no
--     undo), so the write path only ever records the request.
--   - Idempotency: a partial unique index enforces at most one
--     *pending* request per (account_id, phone). A lead who sends
--     APAGAR twice in a row (webhook retry, or just repeating
--     themselves) does not create a second row, the webhook-layer
--     handler (src/lib/eter/data-deletion.ts) checks for an existing
--     pending row before inserting and treats a 23505 from a raced
--     concurrent insert the same way every other repo in this
--     directory does (see pending-actions.repo.ts / contacts dedupe).
--   - `CANCELAR` (same exact-match rule) resolves a pending request
--     back to `cancelled`, for the case where APAGAR was sent by
--     mistake. `status` therefore has three terminal-ish states:
--     pending (default) -> cancelled | completed. `completed` is set
--     manually by the ops team once the deletion has actually
--     happened; nothing in this codebase sets it automatically.
--   - RLS mirrors the operational-class tables in this domain
--     (agent_pending_actions / agent_scheduled_messages): any account
--     member may read/write, only an admin may hard-delete a row (and
--     even that is for cleaning up test data, the normal lifecycle
--     never deletes a row, it only updates `status`).
--   - The webhook route runs under the service-role client (no RLS)
--     same as everywhere else in this codebase.
--
-- Idempotent, safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Normalized (digits-only) phone number of the requester. Kept even
  -- if the contact row is later deleted, so the request record still
  -- says who asked.
  phone            text NOT NULL,
  -- WhatsApp profile name at the time of the request, best-effort,
  -- purely informational for whoever triages the request.
  profile_name     text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'cancelled', 'completed')),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  completed_at     timestamptz,
  -- Set once the geral@/devs@ notification email has been sent
  -- (best-effort, a failed send never blocks the request itself).
  notified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_deletion_requests_account_id_idx
  ON data_deletion_requests (account_id);
CREATE INDEX IF NOT EXISTS data_deletion_requests_conversation_id_idx
  ON data_deletion_requests (conversation_id);
CREATE INDEX IF NOT EXISTS data_deletion_requests_contact_id_idx
  ON data_deletion_requests (contact_id);

-- At most one pending request per phone number within an account,
-- the idempotency guarantee. The webhook-layer handler is expected to
-- check-then-insert first; this index is the actual invariant backstop
-- for concurrent/duplicate webhook deliveries.
CREATE UNIQUE INDEX IF NOT EXISTS data_deletion_requests_one_pending_per_phone
  ON data_deletion_requests (account_id, phone)
  WHERE status = 'pending';

ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_deletion_requests_select ON data_deletion_requests;
CREATE POLICY data_deletion_requests_select ON data_deletion_requests FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS data_deletion_requests_insert ON data_deletion_requests;
CREATE POLICY data_deletion_requests_insert ON data_deletion_requests FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS data_deletion_requests_update ON data_deletion_requests;
CREATE POLICY data_deletion_requests_update ON data_deletion_requests FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS data_deletion_requests_delete ON data_deletion_requests;
CREATE POLICY data_deletion_requests_delete ON data_deletion_requests FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_data_deletion_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS data_deletion_requests_updated_at ON data_deletion_requests;
CREATE TRIGGER data_deletion_requests_updated_at
  BEFORE UPDATE ON data_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_data_deletion_requests_updated_at();
