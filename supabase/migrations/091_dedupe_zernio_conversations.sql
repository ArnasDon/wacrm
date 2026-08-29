-- ============================================================
-- 091_dedupe_zernio_conversations.sql
--
-- Collapses duplicate `conversations` rows that share the same
-- (account_id, zernio_conversation_id), and adds a partial unique index
-- so they can never come back.
--
-- How the duplicates happened
-- ---------------------------
-- The WhatsApp Zernio inbound route resolved a conversation with
-- `.eq('whatsapp_config_id', <config.id>)`. Reconnecting a Zernio number
-- mints a brand-new `whatsapp_config` row (new id), so after a reconnect
-- that filter missed every pre-reconnect thread and the route started a
-- fresh duplicate for each active chat. Inbound then landed on the new
-- rows while `handleOutboundEchoMessageForZernioConversation` — which
-- looks a conversation up by `zernio_conversation_id` alone, with
-- `.maybeSingle()` — began erroring on the now-ambiguous match and
-- silently dropped EVERY Coexistence echo (agent replies sent from the
-- WhatsApp app / Zernio's own inbox) account-wide. First hit on
-- 2026-08-29; account 6ad222e9 was merged by hand that day, this
-- migration cleans up every other account and backstops the code fix
-- (route now matches on `zernio_conversation_id` first; echo lookup no
-- longer bails on >1 row).
--
-- Merge rule
-- ----------
-- Per (account_id, zernio_conversation_id) keep the row with the most
-- messages, ties broken by oldest `created_at` (that row carries the
-- history). Move messages (skipping any that would collide on the
-- (conversation_id, message_id) unique index), notifications, deals,
-- flow_runs and ai_usage_log onto it; `message_reactions` on the losing
-- rows (cosmetic, and none exist in prod at migration time) are left to
-- cascade-delete. Then adopt a non-null `whatsapp_config_id` from the
-- group onto the survivor and refresh its last-message snapshot.
--
-- Idempotent — re-running finds no duplicate groups and only re-asserts
-- the index (IF NOT EXISTS).
--
-- Status: account 6ad222e9 (the account that hit the incident) was
-- de-duped by hand on 2026-08-29. The remaining duplicate groups (all
-- on one other account) plus the unique index are applied by this
-- migration on the next deploy / `supabase db push`.
-- ============================================================

DO $$
DECLARE
  rec RECORD;
BEGIN
  CREATE TEMP TABLE _zconv_merge_map (keep_id uuid, loser_id uuid) ON COMMIT DROP;

  INSERT INTO _zconv_merge_map (keep_id, loser_id)
  SELECT k.keep_id, c.id
  FROM (
    SELECT DISTINCT ON (account_id, zernio_conversation_id)
      account_id, zernio_conversation_id, id AS keep_id
    FROM public.conversations c
    WHERE zernio_conversation_id IS NOT NULL
      AND (account_id, zernio_conversation_id) IN (
        SELECT account_id, zernio_conversation_id
        FROM public.conversations
        WHERE zernio_conversation_id IS NOT NULL
        GROUP BY account_id, zernio_conversation_id
        HAVING count(*) > 1
      )
    ORDER BY account_id, zernio_conversation_id,
             (SELECT count(*) FROM public.messages m WHERE m.conversation_id = c.id) DESC,
             created_at ASC
  ) k
  JOIN public.conversations c
    ON c.account_id = k.account_id
   AND c.zernio_conversation_id = k.zernio_conversation_id
   AND c.id <> k.keep_id;

  IF NOT EXISTS (SELECT 1 FROM _zconv_merge_map) THEN
    RAISE NOTICE '091: no duplicate zernio conversations to merge';
    RETURN;
  END IF;

  -- Messages: move what won't collide on (conversation_id, message_id).
  UPDATE public.messages m
  SET conversation_id = v.keep_id
  FROM _zconv_merge_map v
  WHERE m.conversation_id = v.loser_id
    AND (
      m.message_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.messages k
        WHERE k.conversation_id = v.keep_id AND k.message_id = m.message_id
      )
    );

  UPDATE public.notifications n
  SET conversation_id = v.keep_id
  FROM _zconv_merge_map v
  WHERE n.conversation_id = v.loser_id;

  UPDATE public.deals d
  SET conversation_id = v.keep_id
  FROM _zconv_merge_map v
  WHERE d.conversation_id = v.loser_id;

  UPDATE public.flow_runs f
  SET conversation_id = v.keep_id
  FROM _zconv_merge_map v
  WHERE f.conversation_id = v.loser_id;

  UPDATE public.ai_usage_log l
  SET conversation_id = v.keep_id
  FROM _zconv_merge_map v
  WHERE l.conversation_id = v.loser_id;

  -- Drop the losing rows (cascades away any leftover colliding messages
  -- and message_reactions).
  DELETE FROM public.conversations c
  USING _zconv_merge_map v
  WHERE c.id = v.loser_id;

  -- Adopt a real whatsapp_config_id onto survivors that are still null.
  UPDATE public.conversations c
  SET whatsapp_config_id = src.whatsapp_config_id
  FROM (
    SELECT DISTINCT ON (account_id, zernio_conversation_id)
      account_id, zernio_conversation_id, whatsapp_config_id
    FROM public.conversations
    WHERE whatsapp_config_id IS NOT NULL
    ORDER BY account_id, zernio_conversation_id, created_at DESC
  ) src
  WHERE c.id IN (SELECT keep_id FROM _zconv_merge_map)
    AND c.whatsapp_config_id IS NULL
    AND src.account_id = c.account_id
    AND src.zernio_conversation_id = c.zernio_conversation_id;

  -- Refresh the last-message snapshot on survivors.
  UPDATE public.conversations c
  SET last_message_text = lm.txt,
      last_message_at = lm.at
  FROM (
    SELECT DISTINCT ON (conversation_id)
      conversation_id,
      COALESCE(NULLIF(content_text, ''), '[' || content_type || ']') AS txt,
      created_at AS at
    FROM public.messages
    WHERE conversation_id IN (SELECT keep_id FROM _zconv_merge_map)
    ORDER BY conversation_id, created_at DESC
  ) lm
  WHERE c.id = lm.conversation_id;

  FOR rec IN SELECT count(DISTINCT keep_id) AS kept, count(*) AS dropped FROM _zconv_merge_map LOOP
    RAISE NOTICE '091: merged % duplicate rows into % conversations', rec.dropped, rec.kept;
  END LOOP;
END $$;

-- One conversation row per Zernio conversation per account, forever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_zernio_conv
  ON public.conversations (account_id, zernio_conversation_id)
  WHERE zernio_conversation_id IS NOT NULL;

COMMENT ON INDEX public.idx_conversations_account_zernio_conv IS
  'Guards against duplicate conversation rows for the same Zernio conversation (e.g. after a WhatsApp number reconnect mints a new whatsapp_config id). See migration 091.';
