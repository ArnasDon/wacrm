-- ============================================================
-- 036_conversation_contact_dedup
--
-- Prevent the same contact from fragmenting into multiple
-- conversations within one account (issue #363).
--
-- The inbound webhook and the public-API resolver both follow a
-- "one conversation per (account, contact)" convention, but that
-- convention was only ever enforced in application code with a
-- `.single()` / `.maybeSingle()` lookup and no DB constraint. Two
-- problems compounded:
--
--   1. A race (Meta retries a delivery, or a batch delivers two
--      messages that fan out to concurrent `after()` runs) let two
--      inserts both miss the lookup and create two conversations —
--      unlike contacts (migration 022) there was no unique index and
--      no unique-violation backstop.
--   2. Once ≥2 conversations existed for a contact, the `.single()`
--      lookup errored on *every* subsequent inbound message, so the
--      code fell through and created yet another conversation each
--      time — the duplication snowballed, which is what the reporter
--      saw (a wall of duplicate chats for one number).
--
-- This migration mirrors 022_contact_phone_dedup:
--   1. merges existing duplicate conversations into the oldest row,
--      re-pointing every conversation-scoped child first so nothing
--      is lost;
--   2. adds a UNIQUE index on (account_id, contact_id) — the
--      authoritative guarantee that covers every write path.
--
-- Idempotent. **No data loss** — duplicate conversations are merged,
-- not dropped: child rows (messages, message_reactions, deals,
-- flow_runs, notifications, ai_usage_log) are re-pointed to the
-- surviving (oldest) conversation before the losers are deleted.
-- ============================================================

-- 1) One-time (re-runnable) merge of existing duplicates.
--    SECURITY DEFINER so it can re-point rows across tables
--    regardless of the caller's RLS; it only ever collapses
--    conversations that share the same (account_id, contact_id).
CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_all      UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           contact_id,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids,
           COALESCE(SUM(unread_count), 0)                AS total_unread
    FROM conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  LOOP
    v_all      := v_group.ids;
    v_survivor := v_all[1];
    v_losers   := v_all[2:array_length(v_all, 1)];

    -- Re-point every conversation-scoped child from the losers onto
    -- the survivor. None of these carry a conversation-scoped unique
    -- constraint (message_id is intentionally non-unique — see
    -- migration 009), so a plain UPDATE is safe. Doing this BEFORE the
    -- delete is what saves the ON DELETE CASCADE children (messages,
    -- message_reactions, notifications) from being removed with the
    -- loser conversations.
    UPDATE messages          SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE message_reactions SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE deals             SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE flow_runs         SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE notifications     SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE ai_usage_log      SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);

    -- Roll the merged unread counts onto the survivor and re-derive
    -- its last-message summary from the now-complete message set, so
    -- the surviving thread reflects the full history.
    UPDATE conversations c
    SET unread_count      = v_group.total_unread,
        last_message_text = lm.content_text,
        last_message_at   = lm.created_at,
        updated_at        = NOW()
    FROM (
      SELECT content_text, created_at
      FROM messages
      WHERE conversation_id = v_survivor
      ORDER BY created_at DESC
      LIMIT 1
    ) lm
    WHERE c.id = v_survivor;

    -- Survivor may have no messages at all (edge case). Still fold in
    -- the merged unread count in that case.
    UPDATE conversations
    SET unread_count = v_group.total_unread,
        updated_at   = NOW()
    WHERE id = v_survivor
      AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = v_survivor);

    DELETE FROM conversations WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_conversations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC;

-- Collapse whatever duplicates exist right now.
SELECT public.merge_duplicate_conversations();

-- 2) Authoritative guarantee: one conversation per (account, contact).
--    Every write path (inbound webhook, public-API resolver) now has a
--    DB-level backstop, and its unique-violation handling can re-resolve
--    the winning row instead of compounding duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON conversations (account_id, contact_id);
