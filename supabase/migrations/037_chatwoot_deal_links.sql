-- Chatwoot is the system of record for conversations. This table links its
-- numeric identifiers to a WACRM deal without duplicating messages or tokens.

CREATE TABLE IF NOT EXISTS chatwoot_deal_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  chatwoot_account_id BIGINT NOT NULL,
  chatwoot_contact_id BIGINT NOT NULL,
  chatwoot_conversation_id BIGINT NOT NULL,
  contact_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, chatwoot_conversation_id),
  UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS idx_chatwoot_deal_links_contact
  ON chatwoot_deal_links(account_id, chatwoot_contact_id);

ALTER TABLE chatwoot_deal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY chatwoot_deal_links_select ON chatwoot_deal_links
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY chatwoot_deal_links_insert ON chatwoot_deal_links
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY chatwoot_deal_links_update ON chatwoot_deal_links
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY chatwoot_deal_links_delete ON chatwoot_deal_links
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON chatwoot_deal_links;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON chatwoot_deal_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
