CREATE INDEX IF NOT EXISTS idx_ai_automation_generations_user
  ON ai_automation_generations(user_id)
  WHERE user_id IS NOT NULL;
