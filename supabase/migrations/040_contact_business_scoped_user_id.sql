-- ============================================================
-- 040_contact_business_scoped_user_id
--
-- Give a contact a second identity: WhatsApp's business-scoped user ID
-- (BSUID) and username (issue #519).
--
-- Meta assigns every WhatsApp user a BSUID that is unique within one
-- business portfolio, and once a user adopts a username the message
-- webhook stops carrying their phone number at all — `messages[].from`
-- and `contacts[].wa_id` are both omitted, and only
-- `messages[].from_user_id` / `contacts[].user_id` identify the sender.
--
-- Before this migration those senders had no key to be found under.
-- `contacts.phone` resolved to '' for them, and the unique index from
-- migration 022 is partial (`WHERE phone_normalized <> ''`), so nothing
-- stopped a brand-new contact — and with it a brand-new conversation —
-- being inserted for every inbound message from the same person.
--
-- `phone` deliberately stays NOT NULL. A BSUID-only contact stores ''
-- there, which migration 022's partial index already tolerates and
-- which keeps `Contact.phone` a plain `string` in the app. The new
-- partial unique index below is what guarantees one row per BSUID.
--
-- Idempotent. Additive only — no existing row is modified and no
-- existing constraint changes.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_parent_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_username TEXT;

COMMENT ON COLUMN contacts.wa_user_id IS
  'WhatsApp business-scoped user ID (e.g. "US.13491208655302741918"). Stable per (user, business portfolio) and the primary inbound key when Meta withholds the phone number.';
COMMENT ON COLUMN contacts.wa_parent_user_id IS
  'Portfolio-level BSUID (e.g. "US.ENT.11815799212886844830"). Stored for reference; not used as a lookup key.';
COMMENT ON COLUMN contacts.wa_username IS
  'WhatsApp username, without the leading @. Display only — usernames are user-changeable and must never be used as an identity key.';

-- One contact per BSUID per account — the same guarantee migration 022
-- gave phone numbers. Partial so the millions of rows that will never
-- have a BSUID stay out of the index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_user_id
  ON contacts (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;
