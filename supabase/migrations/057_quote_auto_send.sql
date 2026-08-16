-- ============================================================
-- 057_quote_auto_send.sql
--
-- Bloque 8 follow-up ("Me lo llevo"): a quote created from the public
-- catalog page is delivered as a PDF straight into the customer's
-- WhatsApp thread — instantly if they already have a conversation
-- inside Meta's 24h customer-initiated messaging window, otherwise
-- flagged here so the inbound webhook auto-sends it the moment their
-- next message (re)opens that window. Never touches quotes created any
-- other way (default false).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS auto_send_pending BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.auto_send_pending IS
  'True = this quote (from the public catalog "Me lo llevo" flow) is waiting for the contact''s WhatsApp messaging window to open so its PDF can be auto-sent. Cleared to false once sent, manually or automatically.';
