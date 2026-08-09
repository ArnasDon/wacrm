-- Split one AI answer into a small, configurable number of WhatsApp bubbles.

ALTER TABLE wacrm.ai_configs
  ADD COLUMN IF NOT EXISTS max_reply_chunks integer NOT NULL DEFAULT 3;

ALTER TABLE wacrm.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_max_reply_chunks_check;

ALTER TABLE wacrm.ai_configs
  ADD CONSTRAINT ai_configs_max_reply_chunks_check
  CHECK (max_reply_chunks BETWEEN 1 AND 5);

COMMENT ON COLUMN wacrm.ai_configs.max_reply_chunks IS
  'Maximum WhatsApp bubbles sent for one AI automatic reply.';
