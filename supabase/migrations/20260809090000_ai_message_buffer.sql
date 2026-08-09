-- Buffer rapid inbound WhatsApp fragments before invoking the AI agent.
--
-- Every inbound atomically increments a per-conversation generation. After
-- the configured quiet window, only the invocation whose generation is still
-- current can claim the dispatch. A Flow-consumed message also increments the
-- generation, invalidating any older AI reply without delaying the Flow.

ALTER TABLE wacrm.ai_configs
  ADD COLUMN IF NOT EXISTS buffer_window_seconds integer NOT NULL DEFAULT 12;

ALTER TABLE wacrm.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_buffer_window_seconds_check;

ALTER TABLE wacrm.ai_configs
  ADD CONSTRAINT ai_configs_buffer_window_seconds_check
  CHECK (buffer_window_seconds BETWEEN 1 AND 30);

ALTER TABLE wacrm.conversations
  ADD COLUMN IF NOT EXISTS ai_dispatch_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE wacrm.conversations
  ADD COLUMN IF NOT EXISTS ai_dispatch_claimed_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE wacrm.conversations
  ADD COLUMN IF NOT EXISTS ai_dispatch_pending_since timestamptz;

COMMENT ON COLUMN wacrm.ai_configs.buffer_window_seconds IS
  'Quiet period after the latest inbound message before AI auto-reply runs.';

COMMENT ON COLUMN wacrm.conversations.ai_dispatch_pending_since IS
  'Time of the newest inbound awaiting a buffered AI dispatch; null after claim.';

CREATE OR REPLACE FUNCTION wacrm.schedule_ai_dispatch(
  p_account_id uuid,
  p_conversation_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE wacrm.conversations
  SET ai_dispatch_generation = ai_dispatch_generation + 1,
      ai_dispatch_pending_since = now()
  WHERE id = p_conversation_id
    AND account_id = p_account_id
  RETURNING ai_dispatch_generation;
$$;

CREATE OR REPLACE FUNCTION wacrm.claim_ai_dispatch(
  p_account_id uuid,
  p_conversation_id uuid,
  p_generation bigint
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH claimed AS (
    UPDATE wacrm.conversations
    SET ai_dispatch_claimed_generation = p_generation,
        ai_dispatch_pending_since = NULL
    WHERE id = p_conversation_id
      AND account_id = p_account_id
      AND ai_dispatch_generation = p_generation
      AND ai_dispatch_claimed_generation < p_generation
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

REVOKE ALL ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) TO service_role;
