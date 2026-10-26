CREATE TABLE IF NOT EXISTS pending_message_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  wamid TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code INTEGER,
  error_title TEXT,
  error_details TEXT,
  status_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_message_statuses_account_wamid_status_key
    UNIQUE (account_id, wamid, status)
);

CREATE INDEX IF NOT EXISTS idx_pending_message_statuses_created_at
  ON pending_message_statuses(created_at);

ALTER TABLE pending_message_statuses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE pending_message_statuses FROM anon, authenticated;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS first_inbound_at TIMESTAMPTZ;

UPDATE conversations c
SET first_inbound_at = firsts.first_at
FROM (
  SELECT conversation_id, MIN(created_at) AS first_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) firsts
WHERE c.id = firsts.conversation_id
  AND c.first_inbound_at IS NULL;

DELETE FROM message_reactions older
USING message_reactions newer
WHERE older.actor_type = 'agent'
  AND newer.actor_type = 'agent'
  AND older.message_id = newer.message_id
  AND (older.created_at, older.id) < (newer.created_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reactions_one_agent_reaction
  ON message_reactions(message_id)
  WHERE actor_type = 'agent';
