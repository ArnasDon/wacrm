-- ============================================================
-- 046_whatsapp_contact_name_sync.sql
--
-- Adds a per-config throttle timestamp for the automatic WhatsApp
-- address-book contact-name sync (see
-- src/lib/whatsapp/contact-name-sync.ts). The uazapi webhook route
-- checks this column on every event it receives (connection pings,
-- inbound messages, status updates) and — at most once every 6 hours
-- per account — calls uazapi's GET /contacts?contactScope=address_book
-- to refresh existing contacts' names with whatever the connected
-- WhatsApp number has saved for them.
--
-- Deliberately no cron job and no manual "sync" button: whichever
-- webhook event arrives next after the throttle window opens is
-- enough to trigger the refresh. NULL (the default for every existing
-- row) means "never synced" — the very next event for that account
-- runs the first sync immediately, so accounts that were already
-- connected before this shipped get backfilled automatically too,
-- without needing to reconnect anything.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS contacts_synced_at TIMESTAMPTZ;
