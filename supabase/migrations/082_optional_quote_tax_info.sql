-- ============================================================
-- 082_optional_quote_tax_info.sql
--
-- NIT and email were hard-required on every quote (human quote
-- builder, AI create_quote_chat action) — product decision 2026-08-25:
-- these are optional in practice (many small businesses never collect
-- a customer's NIT/email for a WhatsApp quote — "C/F" consumidor
-- final is the norm), and forcing them into every account's workflow
-- was unwanted friction imposed on all companies rather than a choice
-- each one gets to make for itself.
--
-- Relaxes the DB constraint so a quote can be saved with NIT/email
-- left null, and adds the per-account switch that tells the AI
-- whether to ask the customer for them before building a quote from
-- chat (src/lib/ai/defaults.ts's buildSystemPrompt) — off by default,
-- so no company has to opt out of something it never asked for.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.quotes ALTER COLUMN customer_nit DROP NOT NULL;
ALTER TABLE public.quotes ALTER COLUMN customer_email DROP NOT NULL;

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS ask_customer_tax_info boolean NOT NULL DEFAULT false;
