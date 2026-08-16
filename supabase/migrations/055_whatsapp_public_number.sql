-- ============================================================
-- 055_whatsapp_public_number.sql
--
-- `whatsapp_config` has never stored a dialable phone number —
-- `phone_number_id` is Meta's internal routing ID, and the actual
-- `display_phone_number` is only ever fetched live from the Graph API
-- at connect time to show a toast, never persisted (see
-- src/lib/whatsapp/config-connect.ts's `phoneInfo` return, which is
-- discarded after the request). Zernio-provider rows have no Meta
-- phone number at all.
--
-- Bloque 8 (public catalog page) needs a real, dialable number to
-- build a `wa.me/<number>` link for visitors — so this adds a small
-- admin-editable column instead of doing a live Meta/Zernio API call
-- on an unauthenticated public route (slow, and doesn't work for
-- Zernio). Nullable: NULL means "not set yet," and the public catalog
-- route degrades to omitting the WhatsApp button rather than erroring.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS public_phone_number TEXT;

COMMENT ON COLUMN public.whatsapp_config.public_phone_number IS
  'Dialable WhatsApp number (any format the admin enters, digits extracted at link-build time) shown to visitors on the public catalog page — e.g. wa.me links. Admin-entered in Settings, independent of phone_number_id (Meta''s internal routing ID). NULL = not configured yet.';

-- No RLS change: same policies as the rest of whatsapp_config already
-- cover this column (is_account_member-based read/write for members;
-- the public catalog route reads it via the service-role client).
