-- ============================================================
-- 059_ctwa_fep_and_rescue.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Two independent clocks for Click-to-WhatsApp Ads (CTWA) leads, on
-- top of the `ctwa_referral` origin captured by migration 055:
--
--   1. Free Entry Point (FEP) — a linear, immutable 72h clock that
--      starts the moment the business sends its first message inside
--      the lead's first 24h service window (see maybeActivateCtwaFep
--      in src/lib/whatsapp/ctwa-fep.ts). Never reset, never extended.
--      `ctwa_fep_started_at`/`ctwa_fep_active` are a historical record
--      of "was the benefit ever granted" — NOT re-evaluated over time.
--      Whether the benefit is *currently* live is always derived at
--      read time from `ctwa_fep_expires_at > now()` (see
--      getCtwaFepStatus), so no sweep job is needed to flip anything
--      off at the exact expiry instant.
--
--   2. Rescue automation bookkeeping — `ctwa_rescue_status` guards the
--      preventive ~23h nudge (src/lib/whatsapp/ctwa-rescue.ts) against
--      being sent twice for the same conversation, across cron runs,
--      retries, or concurrent invocations. NULL = not yet evaluated /
--      still a candidate; a non-null value is terminal (this event —
--      "first company response was overdue" — only ever happens once
--      per conversation).
--
-- No new tables: both concepts are one-per-conversation facts, and
-- `conversations` is already the one-row-per-lead-thread surface every
-- other CTWA field (ctwa_referral) and window computation reads from.
--
-- The existing 24h *service* window (message-thread.tsx `sessionInfo`,
-- computed client-side from the last customer message) is NOT
-- duplicated or touched here — it already governs free-text permission
-- identically for CTWA and non-CTWA leads (confirmed: in every cell of
-- the CTWA decision matrix, free-text permission tracks the 24h window
-- alone). These new columns are additive, informational/activation
-- state only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ctwa_fep_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ctwa_fep_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS ctwa_fep_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ctwa_rescue_status text
    CHECK (ctwa_rescue_status IN ('sent', 'cancelled', 'failed')),
  ADD COLUMN IF NOT EXISTS ctwa_rescue_sent_at timestamptz;

COMMENT ON COLUMN conversations.ctwa_fep_started_at IS
  'Timestamp of the business''s first outbound message sent while this CTWA lead''s first 24h service window was still open. Set once, never updated — see maybeActivateCtwaFep().';
COMMENT ON COLUMN conversations.ctwa_fep_expires_at IS
  'ctwa_fep_started_at + 72h. Linear and immutable — never extended by later customer messages.';
COMMENT ON COLUMN conversations.ctwa_fep_active IS
  'Historical flag: was the Free Entry Point benefit ever granted for this conversation. Whether it is CURRENTLY within its 72h is always derived from ctwa_fep_expires_at > now(), not this column — see getCtwaFepStatus().';
COMMENT ON COLUMN conversations.ctwa_rescue_status IS
  'Outcome of the ~23h preventive rescue nudge for a CTWA lead the business never responded to: sent | cancelled (no longer eligible or no safe business-hour slot before the 24h window closed) | failed (send attempt errored). NULL = still a candidate / not yet evaluated. Terminal once set — this event happens at most once per conversation.';
COMMENT ON COLUMN conversations.ctwa_rescue_sent_at IS
  'When the automatic rescue message was sent, if ctwa_rescue_status = ''sent''.';

-- Candidate scan (see list_ctwa_rescue_candidate_ids below) filters on
-- exactly these two columns for every account — index keeps the cron
-- sweep a cheap index scan instead of a seq scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_conversations_ctwa_rescue_candidates
  ON conversations (account_id)
  WHERE ctwa_referral IS NOT NULL AND ctwa_rescue_status IS NULL;

-- ------------------------------------------------------------
-- list_ctwa_rescue_candidate_ids(account) — mirrors the
-- list_unanswered_conversation_ids (047) / list_conversation_last_
-- agent_senders (054) pattern: one SQL function, callable identically
-- from the cron job, so the "who's a rescue candidate" rule lives in
-- exactly one place.
--
-- A candidate is a CTWA conversation that:
--   - has never received an outbound (agent/bot) message at all
--     (the company has NEVER responded to this lead, not just "the
--     last message happens to be from the customer" — a lead who got
--     one reply and then wrote again is not a rescue candidate);
--   - has its most recent customer message roughly 23h old and the
--     first 24h window (computed the same way as the client-side
--     sessionInfo timer: most recent customer message + 24h) still
--     open — i.e. there is still a safe window to act in;
--   - has not already been evaluated (ctwa_rescue_status IS NULL).
--
-- Business-hours + "is there still a safe slot before 24h" logic is
-- NOT expressed here — that needs real timezone math (see
-- src/lib/whatsapp/ctwa-rescue.ts businessHours helpers), which SQL
-- makes awkward. This function only narrows to the ~23h candidate
-- set; the caller re-verifies everything (including business hours)
-- immediately before sending, per the "always re-check right before
-- acting" rule.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_ctwa_rescue_candidate_ids(p_account_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id
  FROM conversations c
  CROSS JOIN LATERAL (
    SELECT MAX(m.created_at) AS last_customer_at
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type = 'customer'
  ) lc
  WHERE c.account_id = p_account_id
    AND c.ctwa_referral IS NOT NULL
    AND c.ctwa_rescue_status IS NULL
    AND lc.last_customer_at IS NOT NULL
    AND lc.last_customer_at <= now() - interval '23 hours'
    AND lc.last_customer_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM messages m2
      WHERE m2.conversation_id = c.id
        AND m2.sender_type IN ('agent', 'bot')
    );
$$;

ALTER FUNCTION public.list_ctwa_rescue_candidate_ids(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_ctwa_rescue_candidate_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_ctwa_rescue_candidate_ids(uuid) TO authenticated, service_role;

-- The rescue message is one more LLM call mode alongside auto_reply /
-- draft / lead_analysis / followup / learning (051/052) — same cost
-- ledger, same widening pattern.
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'lead_analysis', 'followup', 'learning', 'ctwa_rescue'));
