ALTER TABLE ai_agents
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE ai_agents
  DROP CONSTRAINT IF EXISTS ai_agents_user_id_fkey;

ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
