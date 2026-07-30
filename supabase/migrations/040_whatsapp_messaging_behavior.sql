-- ============================================================
-- 040_whatsapp_messaging_behavior
--
-- Three opt-in behaviors for the AI auto-reply agent, configurable
-- per-account from Settings > WhatsApp:
--
--   1. message_buffer_enabled / message_buffer_seconds — debounce
--      rapid-fire inbound messages so the agent replies once per
--      burst instead of once per message. Enforced in-process (see
--      src/lib/ai/reply-buffer.ts), not here; these columns just
--      hold the toggle + delay.
--   2. typing_indicator_enabled — show WhatsApp's "escribiendo..."
--      bubble while the agent is generating a reply.
--   3. mark_read_enabled — mark inbound messages as read (blue
--      double-check) as soon as they arrive. This is the closest
--      thing the Cloud API offers to an "online" signal — genuine
--      presence isn't exposed for business accounts.
--
-- All default false (opt-in) so existing accounts see no behavior
-- change until they turn these on themselves.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS message_buffer_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS message_buffer_seconds integer NOT NULL DEFAULT 30
    CHECK (message_buffer_seconds BETWEEN 5 AND 300);

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS typing_indicator_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS mark_read_enabled boolean NOT NULL DEFAULT false;
