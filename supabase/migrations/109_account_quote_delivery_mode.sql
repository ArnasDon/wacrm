-- ============================================================
-- 109_account_quote_delivery_mode.sql — how quotes get delivered
--
-- Until now every deterministic quote send (the quote builder's "save
-- and send", the public catalog's "Me lo llevo", the WhatsApp webhook
-- auto-send of a pending quote) always attached a rendered PDF. Some
-- companies would rather the quote arrive as a plain WhatsApp message
-- (a text breakdown — no file), which `sendQuoteAsText` already knows
-- how to produce. This column lets each account pick.
--
--   'pdf'     — render + send the PDF document (default, unchanged)
--   'message' — send the itemised total as a text message
--
-- Set from Products → "Entrega del catálogo" (catalog-delivery-settings).
-- Same one-scalar-column convention as `catalog_delivery_mode` (068).
-- Idempotent.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS quote_delivery_mode TEXT NOT NULL DEFAULT 'pdf'
    CHECK (quote_delivery_mode IN ('pdf', 'message'));

COMMENT ON COLUMN public.accounts.quote_delivery_mode IS
  'How deterministic quote sends are delivered (migration 109): pdf = attach the rendered PDF (default), message = send an itemised text breakdown.';
