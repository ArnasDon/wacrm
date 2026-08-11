-- ============================================================
-- Allow lead (contact) deletion when the lead has a deal — same class
-- of bug migration 004 already fixed for deals.contact_id and
-- broadcast_recipients.contact_id.
--
-- deals.conversation_id was declared REFERENCES conversations(id) with
-- no ON DELETE action, so Postgres defaults to NO ACTION. Since every
-- new WhatsApp lead auto-creates a deal with conversation_id set
-- (src/lib/pipelines/auto-deal.ts), deleting a contact — which
-- CASCADEs to delete its conversation (conversations.contact_id ON
-- DELETE CASCADE) — hit that same 23503 the moment the deleted
-- conversation was still referenced by a deal:
--
--   ERROR 23503: update or delete on table "conversations" violates
--   foreign key constraint "deals_conversation_id_fkey" on table "deals"
--
-- Confirmed live against production before writing this migration (a
-- throwaway contact+conversation+deal, deleted, reproduced the error
-- exactly). This was already reachable today via the Contacts page's
-- existing delete button for any contact with a deal — silently
-- failing with a generic "could not delete" toast — not something
-- newly introduced by adding more delete-lead entry points.
--
-- SET NULL (not CASCADE), same rationale as migration 004: the deal
-- survives with a NULL conversation_id rather than being wiped.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_conversation_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      DROP CONSTRAINT deals_conversation_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE SET NULL;
