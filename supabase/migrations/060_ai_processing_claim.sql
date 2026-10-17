-- ============================================================
-- 060_ai_processing_claim.sql — Punto 6 audit, hallazgo H-6.
--
-- PROBLEM: two inbound WhatsApp messages from the same contact,
-- delivered by Meta as two separate webhook calls processed
-- concurrently (each in its own `after()` invocation on serverless —
-- no shared lock between them), can each independently call
-- dispatchInboundToAiReply() for the same conversation_id. Message
-- INSERTION is already race-free (insert_inbound_customer_message(),
-- migration 053, via a row lock on `conversations`), but that
-- serialization ends before dispatchInboundToAiReply() runs. Both
-- dispatches can build conversation context, call the model, and send
-- a reply AT THE SAME TIME — potentially producing two replies both
-- addressing the same (later) message while the earlier one never gets
-- a dedicated answer, or two near-duplicate sends.
-- claim_ai_reply_slot() (migration 029) bounds how MANY replies a
-- conversation can receive; it does nothing to prevent two of those
-- replies from racing each other's context.
--
-- FIX, mirroring the exact pattern already proven in this codebase
-- (insert_inbound_customer_message's row lock, migration 053;
-- claim_ai_reply_slot's atomic UPDATE...WHERE...RETURNING, migration
-- 029; and this engagement's own H-5 fix for the same class of
-- problem in ai_data_sources refreshes):
--
--   1. `conversations.ai_processing_started_at` — a claim column.
--      dispatchInboundToAiReply() atomically claims the conversation
--      (single UPDATE...WHERE...RETURNING from the client, same shape
--      as H-5's) before building context. A second, concurrent dispatch
--      for the SAME conversation fails this claim and returns WITHOUT
--      generating a competing reply.
--
--   2. `release_or_continue_ai_processing(conversation_id,
--      last_seen_message_id)` — the piece a plain client-side UPDATE
--      cannot express atomically: "did a NEWER customer message arrive
--      while I was busy generating my reply?" This needs a read against
--      `messages` (a different table) combined with a conditional write
--      to `conversations`, in ONE indivisible statement — a plain
--      PostgREST filter can't join across tables, so this one step is a
--      small SQL function, exactly like claim_ai_reply_slot's own
--      reasoning for being one. If no newer customer message exists,
--      it releases the claim. If one does, it refreshes the claim's
--      timestamp (extending its staleness window) and reports that so
--      the SAME dispatch that's already holding the claim loops back
--      and answers the new message too — this is what prevents message
--      loss (the "losing" dispatch can safely bail because the winner
--      is guaranteed to notice and cover what it missed) without any
--      in-memory queue, setTimeout, or cross-instance coordination
--      beyond this one table.
--
-- KNOWN, DELIBERATELY ACCEPTED RESIDUAL LIMITATION (stated plainly, not
-- hidden): this closes the practical race — messages arriving even
-- fractions of a second apart, which is the realistic "casi
-- simultáneos" scenario this hallazgo describes. It does not close an
-- theoretically possible, vanishingly narrow window where a customer's
-- message commits in the exact same instant as this function's own
-- internal SELECT executes (a single statement's execution time on the
-- database server — microseconds). Closing that last sliver would need
-- the message INSERT and this CHECK to share one transaction, which
-- they structurally cannot (they come from two independent HTTP
-- requests). No mechanism proposed for this fix eliminates that
-- instant-of-commit race; only a scale of concurrency far beyond a
-- customer's own typing speed could ever hit it in practice.
--
-- STALE CLAIM: same self-expiry reasoning as H-5, with a larger window
-- because this operation does more (embeddings, Business Profile,
-- catalog tool-calling with up to MAX_TOOL_TURNS round trips, the
-- provider call itself, the WhatsApp send) and the drain loop above can
-- repeat that whole sequence a bounded few times. 10 minutes
-- comfortably exceeds any realistic single pass (each provider call is
-- itself capped by AI_REQUEST_TIMEOUT_MS, default 30s) while still
-- recovering a crashed/killed instance's claim well within the time a
-- real conversation would otherwise sit unanswered.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_processing_started_at timestamptz;

COMMENT ON COLUMN conversations.ai_processing_started_at IS
  'Set while dispatchInboundToAiReply() is actively building context/generating/sending a reply for this conversation (H-6). NULL = no AI processing in flight. A non-NULL value older than the staleness window used by the application is treated as abandoned (crashed/killed instance) and may be reclaimed.';

CREATE OR REPLACE FUNCTION public.release_or_continue_ai_processing(
  p_conversation_id uuid,
  p_last_seen_message_id uuid
)
RETURNS TABLE(released boolean, latest_message_id uuid) AS $$
DECLARE
  v_latest uuid;
BEGIN
  -- The most recent customer text message right now — a single,
  -- indexed lookup (idx_messages_conversation covers conversation_id;
  -- the per-conversation row count is small enough that ordering the
  -- match by created_at needs no dedicated composite index, the same
  -- reasoning buildConversationContext's own query already relies on).
  SELECT id INTO v_latest
  FROM messages
  WHERE conversation_id = p_conversation_id
    AND sender_type = 'customer'
    AND content_type = 'text'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest IS NULL OR v_latest = p_last_seen_message_id THEN
    -- Nothing newer than what the caller already answered — release.
    UPDATE conversations SET ai_processing_started_at = NULL WHERE id = p_conversation_id;
    RETURN QUERY SELECT true, v_latest;
  ELSE
    -- A newer customer message exists — keep the claim (refresh its
    -- timestamp so the staleness window restarts from now) and tell the
    -- caller to loop back and answer it, rather than letting a second,
    -- competing dispatch race in.
    UPDATE conversations SET ai_processing_started_at = now() WHERE id = p_conversation_id;
    RETURN QUERY SELECT false, v_latest;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The auto-reply bot calls this under the service-role client (the
-- inbound webhook has no auth.uid()) — same reasoning, same grant
-- shape as claim_ai_reply_slot (migration 029).
GRANT EXECUTE ON FUNCTION public.release_or_continue_ai_processing(uuid, uuid) TO service_role;
