-- ============================================================
-- 069_contact_archiving.sql — Arquivar Contato
--
-- Same convention as deals.archived_at (067_deal_archiving.sql):
-- a nullable timestamp, reversible, orthogonal to deleting the row.
-- Archived contacts are excluded from the default Contacts list
-- query but the row itself is untouched.
--
-- No RLS change needed — contacts_update already allows any account
-- member to write any column.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_account_archived
  ON contacts (account_id, archived_at);
