-- Bind a generation id to the exact schema-normalized automation draft
-- without persisting user-authored automation content.

ALTER TABLE ai_automation_generations
  ADD COLUMN IF NOT EXISTS draft_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_automation_generations_draft_hash_format'
      AND conrelid = 'public.ai_automation_generations'::regclass
  ) THEN
    ALTER TABLE ai_automation_generations
      ADD CONSTRAINT ai_automation_generations_draft_hash_format
      CHECK (draft_hash IS NULL OR draft_hash ~ '^[0-9a-f]{64}$');
  END IF;
END
$$;

COMMENT ON COLUMN ai_automation_generations.draft_hash IS
  'SHA-256 of the schema-normalized canonical draft; null for question/failed turns.';
