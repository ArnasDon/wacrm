-- ============================================================
-- 042_aisdr_approval_forward_queue.sql, forwarding queue for the AI
-- SDR approval buttons ([Enviar]/[Descartar]) the Ricardo taps in
-- WhatsApp.
--
-- Context: the Meta webhook used to point at eter-whatsapp-agent
-- (:3009), which recognised the `aisdr_send_{id}` / `aisdr_discard_{id}`
-- button ids and forwarded the decision to the AI SDR worker's
-- POST /api/approvals/decision. Since 11 Aug the single Meta webhook
-- points at EterWA instead, and this repo had no code that recognised
-- those buttons at all, decisions fell into the void (9 approvals
-- stuck in the AI SDR's `pending_approvals` table since 31 Jul). See
-- src/lib/eter/aisdr-approval-forward.ts for the forwarding logic that
-- writes to this table; src/app/api/whatsapp/webhook/route.ts is the
-- only inbound caller.
--
-- Design notes
--   - This table is NOT a mirror of the AI SDR's own `pending_approvals`
--     — it never left this repo's boundary. It exists purely so a
--     forward that fails after every retry is not lost (persisted for
--     later reprocessing) and so the SAME webhook delivery, redelivered
--     by Meta, or the SAME button tapped twice, is never forwarded
--     twice.
--   - Idempotency has two independent guards, because two different
--     kinds of duplication can happen:
--       1. Meta redelivers the identical webhook (same WhatsApp
--          message id for the button tap) — guarded by the UNIQUE
--          index on `wa_message_id`. The forwarding code claims a row
--          by inserting it before attempting the HTTP call; a conflict
--          means this exact delivery was already seen and is a no-op.
--       2. Ricardo taps the same button twice in the app, producing
--          TWO DIFFERENT WhatsApp message ids for the same
--          (approval_id, decision) pair. Guarded by looking up any
--          existing `forwarded` row for the same `approval_id` before
--          attempting a new one; a match short-circuits to
--          `skipped_duplicate` (still recorded, for the audit trail)
--          instead of calling the AI SDR again.
--   - `status`: `pending` (claimed, forward in flight — should only
--     ever be observed mid-request, never at rest), `forwarded`
--     (success), `failed` (every retry in this attempt group was
--     exhausted, queued for the reprocessing cron), `gave_up` (the
--     reprocessing cron also exhausted its own retry budget —
--     terminal, needs a human), `skipped_duplicate` (idempotency
--     guard #2 above).
--   - `attempts` counts ATTEMPT GROUPS, not individual HTTP calls —
--     each group already retries internally (see
--     AISDR_FORWARD_MAX_ATTEMPTS in aisdr-approval-forward.ts). The
--     reprocessing cron increments this once per tick it picks the row
--     up, and gives up once it crosses AISDR_FORWARD_MAX_QUEUE_ATTEMPTS.
--   - No RLS-exposed read/write path is needed for end users — this is
--     an internal operational queue, written and read only by the
--     webhook route and the reprocessing cron route, both under the
--     service-role client (same as every other table in this domain).
--     RLS is still enabled with the same account_id-scoped read policy
--     as its siblings, in case an operator dashboard wants to surface
--     stuck rows later; there is deliberately no end-user INSERT/UPDATE
--     policy since only server code writes here.
--
-- Idempotent, safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS aisdr_approval_forwards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- WhatsApp message id of the button tap that triggered this forward
  -- attempt. Unique per delivery, the primary idempotency guard against
  -- Meta redelivering the same webhook.
  wa_message_id  text NOT NULL,
  -- AI SDR's pending_approvals.id (bigserial there, kept as bigint here).
  approval_id    bigint NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('send', 'discard')),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'forwarded', 'failed', 'gave_up', 'skipped_duplicate')),
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  forwarded_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS aisdr_approval_forwards_wa_message_id_key
  ON aisdr_approval_forwards (wa_message_id);

CREATE INDEX IF NOT EXISTS aisdr_approval_forwards_account_id_idx
  ON aisdr_approval_forwards (account_id);

-- Idempotency guard #2 (double-tap): fast lookup of "is this approval_id
-- already forwarded" before attempting a new one.
CREATE INDEX IF NOT EXISTS aisdr_approval_forwards_approval_id_idx
  ON aisdr_approval_forwards (approval_id);

-- Reprocessing cron sweep: due `failed` rows, oldest first.
CREATE INDEX IF NOT EXISTS aisdr_approval_forwards_status_updated_at_idx
  ON aisdr_approval_forwards (status, updated_at);

ALTER TABLE aisdr_approval_forwards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aisdr_approval_forwards_select ON aisdr_approval_forwards;
CREATE POLICY aisdr_approval_forwards_select ON aisdr_approval_forwards FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.update_aisdr_approval_forwards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aisdr_approval_forwards_updated_at ON aisdr_approval_forwards;
CREATE TRIGGER aisdr_approval_forwards_updated_at
  BEFORE UPDATE ON aisdr_approval_forwards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_aisdr_approval_forwards_updated_at();
