CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'AI Inbox Agent',
  enabled BOOLEAN NOT NULL DEFAULT false,
  model_provider TEXT NOT NULL DEFAULT 'openai',
  model_name TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
  instructions TEXT NOT NULL DEFAULT '',
  auto_reply BOOLEAN NOT NULL DEFAULT true,
  auto_move_deals BOOLEAN NOT NULL DEFAULT false,
  handoff_keywords TEXT[] NOT NULL DEFAULT ARRAY['humano', 'atendente', 'cancelar'],
  max_messages INTEGER NOT NULL DEFAULT 20,
  cooldown_seconds INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id)
);

CREATE TABLE IF NOT EXISTS ai_conversation_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ai_agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'handoff', 'disabled')),
  last_inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_run_at TIMESTAMPTZ,
  paused_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  decision JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_account ON ai_agents(account_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversation_states_account ON ai_conversation_states(account_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_conversation ON ai_agent_runs(conversation_id, created_at DESC);

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversation_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agents_select ON ai_agents FOR SELECT USING (is_account_member(account_id));
CREATE POLICY ai_agents_modify ON ai_agents FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY ai_conversation_states_select ON ai_conversation_states FOR SELECT USING (is_account_member(account_id));
CREATE POLICY ai_conversation_states_modify ON ai_conversation_states FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY ai_agent_runs_select ON ai_agent_runs FOR SELECT USING (is_account_member(account_id));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_conversation_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
