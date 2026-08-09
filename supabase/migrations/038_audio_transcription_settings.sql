-- ============================================================
-- 038_audio_transcription_settings
--
-- Per-account control for inbound WhatsApp voice-note transcription.
-- Existing accounts keep the current behaviour (enabled by default).
-- ============================================================

ALTER TABLE wacrm.ai_configs
  ADD COLUMN IF NOT EXISTS transcription_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN wacrm.ai_configs.transcription_enabled IS
  'When true, inbound WhatsApp audio may be transcribed using the account OpenAI key.';
