-- ============================================================
-- 037_webhook_broadcast_reliability
--
-- Three independent reliability fixes that all need a DB-level
-- guarantee the application layer can't provide on its own:
--
--   #367  Inbound-webhook idempotency. Meta retries webhook
--         deliveries; an unconditional message INSERT persisted the
--         same inbound message twice and re-ran every downstream
--         side effect. A unique index on (conversation_id,
--         message_id) turns a replay into an ON CONFLICT no-op.
--
--   #369  Concurrent inbound messages lost unread-count increments.
--         The webhook did a read-modify-write of unread_count, so
--         two concurrent deliveries for one conversation both read N
--         and both wrote N+1. Moved to a DB-side atomic increment
--         (mirrors migration 007's automation-counter fix).
--
--   #370  Broadcast creation persisted the parent row before the
--         recipients, leaving an orphaned `sending` broadcast with
--         no recipients when the recipient insert failed. A single
--         function runs both inserts in one transaction, so a
--         recipient failure rolls the parent back.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- #367 — inbound webhook idempotency
--
-- The Meta message id is unique per receiving number, and a given
-- (account, contact) always resolves to the same conversation
-- (guaranteed by migration 036), so (conversation_id, message_id)
-- is the correct idempotency key — `message_id` alone is NOT
-- globally unique across phone numbers (see migration 009).
--
-- A plain (non-partial) unique index is used deliberately so
-- PostgREST's `ON CONFLICT` arbiter inference works from the column
-- list alone. NULL `message_id`s (outbound rows mid-send, before the
-- Meta wamid lands) are treated as distinct by a standard unique
-- index, so they never collide with each other.
-- ============================================================

-- Collapse pre-existing duplicates (keep the earliest row per key —
-- it's the one whose downstream side effects already ran) so the
-- unique index can be created. Only rows with a non-NULL message_id
-- can collide. reply_to_message_id is ON DELETE SET NULL (migration
-- 009) and reactions cascade, so removing a strict duplicate is safe.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY conversation_id, message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM messages
  WHERE message_id IS NOT NULL
)
DELETE FROM messages m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON messages (conversation_id, message_id);

-- ============================================================
-- #369 — atomic unread-count increment on inbound
--
-- Replaces the webhook's read-modify-write. The increment happens
-- entirely inside the UPDATE so concurrent inbound deliveries for
-- the same conversation can't lose each other's bump. Also refreshes
-- the last-message summary in the same statement (matching the old
-- code's semantics: last_message_at = now, not the Meta timestamp).
-- ============================================================
CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count      = COALESCE(unread_count, 0) + 1,
      last_message_text = p_last_message_text,
      last_message_at   = NOW(),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;

-- Only the service role (webhook) calls this. Lock everyone else out
-- so an authenticated user can't bump another account's unread count.
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) TO service_role;

-- ============================================================
-- #370 — atomic broadcast creation
--
-- Inserts the parent `broadcasts` row and all `broadcast_recipients`
-- rows in a single transaction (a function body is atomic), then
-- returns the created ids so the caller can build its send plan. If
-- the recipient insert fails, the parent insert rolls back and no
-- orphaned `sending` broadcast survives.
--
-- Per-status count columns are intentionally NOT seeded — they're
-- owned by the aggregate trigger (migrations 003/005), same as the
-- previous application-side insert.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id       UUID,
  p_user_id          UUID,
  p_name             TEXT,
  p_template_name    TEXT,
  p_template_language TEXT,
  p_total_recipients INTEGER,
  p_contact_ids      UUID[]
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (broadcast_id, contact_id, status)
    SELECT v_broadcast_id, cid, 'pending'
    FROM unnest(p_contact_ids) AS cid
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) TO service_role;
