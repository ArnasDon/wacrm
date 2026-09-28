-- ============================================================
-- 050_advanced_campaigns
--
-- "Advanced" campaigns: one campaign fans out over several WhatsApp
-- channels at once, with an ordered list of templates. When Meta pauses
-- or disables a template mid-send, the rest of the audience goes out on
-- the next template in the list.
--
--   broadcasts.kind   — 'standard' (the existing single-template wizard)
--                       or 'advanced'.
--   broadcasts.config — the advanced plan: channel ids, template order,
--                       CSV column → variable mapping, send speed, and
--                       the runtime record of which templates each
--                       channel had to give up on.
--
--   broadcast_recipients.whatsapp_config_id / template_name /
--   template_language — which channel and template actually carried the
--   message (stamped when it is sent).
--   broadcast_recipients.row_data — the recipient's CSV cells that the
--   variable mapping refers to. Variables are resolved at send time, per
--   template, because a fallback template can take different variables.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_kind_check'
  ) THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_kind_check CHECK (kind IN ('standard', 'advanced'));
  END IF;
END $$;

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS config JSONB;

COMMENT ON COLUMN broadcasts.config IS
  'Advanced campaign plan (channels, template order, CSV mapping, speed, exhausted templates). NULL for standard campaigns. See 050_advanced_campaigns.sql.';

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS template_language TEXT,
  ADD COLUMN IF NOT EXISTS row_data JSONB;

-- The scheduler looks for due scheduled campaigns and for sending ones
-- whose runner went away.
CREATE INDEX IF NOT EXISTS idx_broadcasts_advanced_status
  ON broadcasts(status, scheduled_at)
  WHERE kind = 'advanced';
