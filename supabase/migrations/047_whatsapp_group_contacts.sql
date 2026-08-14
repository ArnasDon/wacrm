-- ============================================================
-- 047_whatsapp_group_contacts.sql
--
-- Groups/communities/channels are no longer silently dropped by the
-- uazapi webhook (see the route's own comment) — they're now shown in
-- the inbox the way WhatsApp itself shows them: under their own
-- filter, with the group's real name/photo instead of a raw numeric
-- id or the name of whoever last posted in it.
--
-- `kind` distinguishes a group/community/channel "contact" row (the
-- group itself, not a person) from a real 1:1 contact. Every existing
-- row is `individual` — nothing behavioral changes for them. The
-- webhook route sets `kind` on insert going forward; it's never
-- flipped after creation (a chat's fundamental type doesn't change).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'individual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_kind_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_kind_check
      CHECK (kind IN ('individual', 'group', 'community', 'channel'));
  END IF;
END $$;

-- Inbox list default view filters this out constantly (`kind = 'individual'`
-- via a "not group" predicate) — index it since every account's inbox
-- query will hit it.
CREATE INDEX IF NOT EXISTS idx_contacts_kind ON contacts(account_id, kind);
