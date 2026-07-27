-- ============================================================
-- broadcasts: support free-text sends for non-Meta providers
--
-- Meta requires a pre-approved template for any business-initiated
-- broadcast — that's Meta's own policy, not this app's choice (see
-- migration 037's comment on whatsapp_config.provider). uazapi rides
-- a personal number with no approval pipeline, so a uazapi-provider
-- broadcast sends free-form text (optionally with one media
-- attachment) instead of a template.
--
-- `template_name` moves from required to optional; `body_text` is its
-- free-text counterpart. Every broadcast must have exactly one
-- content source — the CHECK below enforces "at least template_name
-- or body_text", mirroring how `whatsapp_config`'s CHECK enforces
-- "exactly the right columns for this row's provider".
--
-- Personalization reuses the same positional placeholder convention
-- templates already use ({{1}}, {{2}}, …) — `body_text` is stored
-- with those placeholders and interpolated per-recipient at delivery
-- time using the same `params` array the wizard already builds via
-- resolveVariables() (src/hooks/use-broadcast-sending.ts). No new
-- personalization engine needed.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE broadcasts ALTER COLUMN template_name DROP NOT NULL;

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS body_text TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_kind TEXT
    CHECK (media_kind IN ('image', 'video', 'document', 'audio'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'broadcasts_content_source_check'
      AND conrelid = 'broadcasts'::regclass
  ) THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_content_source_check
      CHECK (template_name IS NOT NULL OR body_text IS NOT NULL);
  END IF;
END $$;
