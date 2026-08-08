ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_context_reset_at timestamptz;

COMMENT ON COLUMN conversations.ai_context_reset_at IS
  'AI ignores messages created before this timestamp while preserving conversation history.';
