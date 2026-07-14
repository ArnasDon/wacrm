-- ============================================================
-- 023_generic_webhooks.sql — Generic Webhooks feature
-- ============================================================

-- Table for generic webhook integrations/configurations
CREATE TABLE IF NOT EXISTS webhook_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  is_connected BOOLEAN NOT NULL DEFAULT FALSE,
  last_payload JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_integrations_account ON webhook_integrations(account_id);

ALTER TABLE webhook_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can manage webhook integrations" ON webhook_integrations;
CREATE POLICY "Members can manage webhook integrations" ON webhook_integrations FOR ALL
  USING (is_account_member(account_id));

-- Table for webhook workflows (up to 5 per integration)
CREATE TABLE IF NOT EXISTS webhook_workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES webhook_integrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recipient_name_field TEXT NOT NULL, -- JSON path, e.g. "customer.name"
  recipient_phone_field TEXT NOT NULL, -- JSON path, e.g. "customer.phone"
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of condition objects
  actions JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of action objects (e.g. send template)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_workflows_integration ON webhook_workflows(integration_id);

ALTER TABLE webhook_workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can manage webhook workflows" ON webhook_workflows;
CREATE POLICY "Members can manage webhook workflows" ON webhook_workflows FOR ALL
  USING (is_account_member(account_id));

-- Table for webhook execution logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES webhook_integrations(id) ON DELETE SET NULL,
  workflow_id UUID REFERENCES webhook_workflows(id) ON DELETE SET NULL,
  workflow_name TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'no_match')),
  error_message TEXT,
  payload JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_account ON webhook_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_workflow ON webhook_logs(workflow_id);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view webhook logs" ON webhook_logs;
CREATE POLICY "Members can view webhook logs" ON webhook_logs FOR SELECT
  USING (is_account_member(account_id));

-- Triggers for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON webhook_integrations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON webhook_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON webhook_workflows;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON webhook_workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
