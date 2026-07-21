-- ============================================================
-- 039_ai_reply_cap_rpc.sql — atomic reply-cap claim for the WhatsApp
-- AI agent
--
-- Restores `claim_ai_reply_slot(uuid, integer)`, dropped by
-- 037_drop_ai.sql along with the rest of the old AI reply-assistant
-- feature, for use by the new AI agent added in 038_ai_agent.sql.
--
-- Why this has to be a server-side function and not a client-computed
-- UPDATE: `agent-dispatch.ts` is fire-and-forget and can run
-- concurrently for the same conversation (e.g. a customer sending
-- several WhatsApp messages in quick succession). A client-side
-- "read ai_reply_count, check < cap, then UPDATE ... SET
-- ai_reply_count = <constant computed from the stale read>" lets two
-- concurrent callers both read the same count, both pass the check,
-- and both write the same stale-plus-one value — overshooting the cap.
-- Here the cap check (`WHERE ai_reply_count < max_replies`) and the
-- increment (`SET ai_reply_count = ai_reply_count + 1`, evaluated
-- against the live row) happen inside a single UPDATE statement, so
-- Postgres serializes concurrent callers correctly: only callers whose
-- UPDATE executes while the row is still under the cap can succeed.
-- Returns true when a slot was claimed (the caller may send), false
-- when the cap was already reached (skip / hand off).
--
-- Grant mirrors the 030/031 precedent: SECURITY DEFINER functions
-- default to PUBLIC execute, which migration 031 had to patch in after
-- the fact once for this very function because a hardened Postgres
-- instance had revoked it — granted directly here to service_role only
-- (the sole caller: the webhook-driven dispatch path has no
-- auth.uid()).
--
-- Idempotent — safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;
