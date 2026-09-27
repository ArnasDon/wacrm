-- ============================================================
-- 049: Where Meta delivers each channel's webhooks
-- ============================================================
--
-- Another platform connected to the same WABA can set an override
-- callback URL (on the WABA subscription or the phone number); Meta then
-- sends that number's messages and delivery statuses there instead of to
-- this app. Cached from the number's `webhook_configuration` on connect
-- and refresh so the WhatsApp page can warn and offer to fix it.
--
-- Idempotent: safe to re-run.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS webhook_url TEXT;
