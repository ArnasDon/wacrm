CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_runs_inbound_unique
  ON ai_agent_runs(account_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;
