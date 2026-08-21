-- ============================================================
-- 079_envio_leads_mensagem.sql — per-lead message for Envios.
--
-- The real upload format (the file the Campanhas system already
-- exports) gives each recipient its OWN final, already-personalized
-- message (`recipients[i].message`) — there is no {{template}} for
-- WACRM to fill in. A single shared `envios.mensagem_texto` can't
-- represent that, so the message moves to `envio_leads` (one per
-- recipient); the image stays shared at the `envios` level
-- (`mensagem_imagem_url`, migration 078 — one `creative.url` per
-- campaign, unchanged).
--
-- `envios.mensagem_texto` is dropped outright, not just deprecated —
-- the "Upload da campanha" flow is the only way to create an Envio,
-- and it always provides a per-lead message, so nothing reads a
-- shared envio-level message anymore.
--
-- Safe to run: both `envios` and `envio_leads` are empty in
-- production as of this migration (verified before running).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE envio_leads ADD COLUMN IF NOT EXISTS mensagem TEXT;
ALTER TABLE envio_leads ALTER COLUMN mensagem SET NOT NULL;

ALTER TABLE envios DROP COLUMN IF EXISTS mensagem_texto;
