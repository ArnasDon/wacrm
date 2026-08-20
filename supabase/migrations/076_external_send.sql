-- ============================================================
-- 076_external_send.sql — second send channel for Campaigns: 'external'
-- (a free-text message + optional image, sent manually by a human/bot
-- through an already-logged-in WhatsApp Web session, NOT the official
-- WhatsApp Business API).
--
-- Still one campaign engine, one table. `send_channel` distinguishes
-- the two paths on the SAME `broadcasts` row:
--   'api'      — unchanged: template_name/template_language/
--                template_variables drive Meta's official API (the
--                whole flow built in migration 075).
--   'external' — message_text is the free-text body; header_media_url
--                (already added in migration 075 for API media
--                headers) is reused as the optional image URL — no
--                new "image" column needed for the same concept.
--                template_name is NULL for these rows.
--
-- WACRM's job for 'external' campaigns is only to prepare + register
-- the campaign and its recipients (status stays 'pending' until an
-- outside process reports a result back via
-- POST /api/v1/campaigns/{id}/recipients/{recipientId}/result) — it
-- never calls Meta for these rows. No new table: `broadcast_recipients`
-- already carries status/sent_at/error_message/whatsapp_message_id,
-- which is exactly what an external send result needs to record
-- (whatsapp_message_id doubles as "the external executor's reference
-- id for this send" when send_channel = 'external').
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS send_channel TEXT NOT NULL DEFAULT 'api';
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_send_channel_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_send_channel_check
  CHECK (send_channel IN ('api', 'external'));

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS message_text TEXT;

-- template_name was NOT NULL (migration 001) — external campaigns have
-- no template at all, so it must become nullable. A CHECK enforces
-- each channel still has the content it needs.
ALTER TABLE broadcasts ALTER COLUMN template_name DROP NOT NULL;

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_channel_content_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_channel_content_check
  CHECK (
    (send_channel = 'api' AND template_name IS NOT NULL)
    OR (send_channel = 'external' AND message_text IS NOT NULL)
    -- draft rows (no recipients yet, section "Rascunho") may not have
    -- either populated yet — only enforce once a campaign leaves draft.
    OR status = 'draft'
  );

CREATE INDEX IF NOT EXISTS idx_broadcasts_send_channel ON broadcasts(send_channel);
