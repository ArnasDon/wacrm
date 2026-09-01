-- ============================================================
-- 098 — contacts.referral
--
-- Where a contact FIRST reached us. Populated once, at contact
-- creation, from the Meta ad/post referral that rode along with the
-- opening DM:
--
--   * Click-to-Messenger / Click-to-Instagram ads  -> { source: 'ADS',
--     type: 'OPEN_THREAD', ad_id, ref }
--   * a post / story "Send message" button          -> { source: 'POST'
--     | 'SHORTLINK', ref }
--   * the website chat plugin                       -> { source:
--     'CUSTOMER_CHAT_PLUGIN', ref }
--
-- NULL for organic DMs, non-Meta channels, and every contact created
-- before this migration. Never overwritten on later messages, so it
-- always reflects the true first touch — handy for "which campaign did
-- this lead come from" reporting (and the Google Sheets export).
--
-- Idempotent; safe to re-run.
-- ============================================================

alter table public.contacts
  add column if not exists referral jsonb;

comment on column public.contacts.referral is
  'First-touch Meta ad/post referral payload ({source,type,ad_id,ref}) captured on contact creation from the opening DM. NULL for organic / non-Meta / pre-098 contacts. Set once, never overwritten.';
