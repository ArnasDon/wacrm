-- Short-lived operational catalogue state for the AI agent.
-- This is deliberately separate from contact_memories: it stores what was
-- shown/selected in the current conversation, not durable customer facts.

CREATE TABLE IF NOT EXISTS wacrm.conversation_catalog_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES wacrm.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES wacrm.conversations(id) ON DELETE CASCADE,
  last_query text,
  last_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  shown_product_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  shown_media_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  rejected_product_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  selected_product_key text,
  selected_product_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_catalog_state_account_conversation_key
    UNIQUE (account_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS conversation_catalog_state_conversation_idx
  ON wacrm.conversation_catalog_state (conversation_id);

ALTER TABLE wacrm.conversation_catalog_state ENABLE ROW LEVEL SECURITY;

-- Runtime access is through the service-role Supabase client. Keeping the
-- table without authenticated-user policies prevents accidental exposure of
-- internal agent state through the browser client.
GRANT SELECT, INSERT, UPDATE, DELETE ON wacrm.conversation_catalog_state TO service_role;
