-- ============================================================
-- 043_dedupe_conversations.sql
--
-- Prevent duplicate conversations per (account_id, contact_id).
--
-- The CRM models one continuous conversation thread per contact
-- within each account (reopening `closed` -> `open` on new inbound
-- messages). Without a database UNIQUE constraint, concurrent
-- webhooks or outbound sends could insert a second row, causing
-- `.single()` / `.maybeSingle()` lookups to fail with PGRST116 and
-- loop into creating a brand-new conversation on every message.
--
-- This migration, inside a single transaction:
--   1. Ensures `last_agent_message_at` exists on `conversations`.
--   2. Defines `public.merge_duplicate_conversations()` to safely
--      merge any existing duplicates per (account_id, contact_id):
--        - Elects 1 survivor (most recent message/activity).
--        - Deduplicates colliding customer `message_id` rows first
--          (respecting `messages_customer_meta_id_unique`, replies,
--          reactions, and `flow_runs.last_prompt_message_id`).
--        - Repoints ALL child tables referencing `conversations(id)`
--          (`messages`, `message_reactions`, `deals`, `flow_runs`,
--          `notifications`, `order_drafts` [handling UNIQUE],
--          `order_draft_history`, `order_inbound_events`,
--          `order_message_outbox`, and `orders.payment_conversation_id`).
--        - Consolidates `status`, `unread_count`, `assigned_agent_id`,
--          `last_message_*`, and AI/handoff state on the survivor.
--        - Deletes duplicate conversation rows only after all child
--          references are migrated.
--   3. Executes the merge (suppressing handoff/assignment notification
--      triggers during consolidation, then re-enabling them).
--   4. Enforces `UNIQUE (account_id, contact_id)` via
--      `idx_conversations_account_contact_unique`.
--   5. Defines atomic RPC `public.resolve_or_create_conversation(...)`
--      returning `{ conversation, is_new }` with zero race conditions.
-- ============================================================

BEGIN;

-- Defensive: referenced by 039/042 and app code; ensure it exists on
-- clean environments bootstrapped solely from migrations.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_agent_message_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 1) Safe merge of existing duplicate conversations
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group                 RECORD;
  v_all_ids               UUID[];
  v_survivor              UUID;
  v_losers                UUID[];
  v_msg_group             RECORD;
  v_keep_msg              UUID;
  v_drop_msgs             UUID[];
  v_drop_msg              UUID;
  v_keep_draft            UUID;
  v_unread_sum            INTEGER;
  v_last_msg_text         TEXT;
  v_last_msg_at           TIMESTAMPTZ;
  v_assigned_agent_id     UUID;
  v_max_agent_at          TIMESTAMPTZ;
  v_max_resumed_at        TIMESTAMPTZ;
  v_latest_status         TEXT;
  v_final_status          TEXT;
  v_ai_disabled           BOOLEAN;
  v_ai_reply_count        INTEGER;
  v_bot_pause_reason      TEXT;
  v_bot_paused_at         TIMESTAMPTZ;
  v_bot_resume_after      TIMESTAMPTZ;
  v_bot_handoff_id        UUID;
  v_has_orders_pay_conv   BOOLEAN;
  v_merged                INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'payment_conversation_id'
  )
  INTO v_has_orders_pay_conv;

  FOR v_group IN
    SELECT
      c.account_id,
      c.contact_id,
      array_agg(
        c.id
        ORDER BY
          (c.last_message_at IS NULL) ASC,
          COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC NULLS LAST,
          c.updated_at DESC NULLS LAST,
          c.created_at DESC NULLS LAST,
          c.id DESC
      ) AS ids
    FROM public.conversations c
    GROUP BY c.account_id, c.contact_id
    HAVING count(*) > 1
  LOOP
    v_all_ids  := v_group.ids;
    v_survivor := v_all_ids[1];
    v_losers   := v_all_ids[2:array_length(v_all_ids, 1)];

    -- Lock all rows in deterministic order to avoid concurrent deadlocks.
    PERFORM 1
    FROM public.conversations
    WHERE id = ANY(v_all_ids)
    ORDER BY id
    FOR UPDATE;

    -- ---- Consolidate state BEFORE mutating child rows --------
    SELECT
      COALESCE(SUM(GREATEST(COALESCE(c.unread_count, 0), 0)), 0)::INTEGER,
      MAX(c.last_agent_message_at),
      MAX(c.bot_order_resumed_at)
    INTO
      v_unread_sum,
      v_max_agent_at,
      v_max_resumed_at
    FROM public.conversations c
    WHERE c.id = ANY(v_all_ids);

    SELECT c.last_message_text, c.last_message_at, c.status
    INTO v_last_msg_text, v_last_msg_at, v_latest_status
    FROM public.conversations c
    WHERE c.id = v_survivor;

    -- Fallback: if survivor has null last_message_at, look up any row in the group
    IF v_last_msg_at IS NULL THEN
      SELECT c.last_message_text, c.last_message_at
      INTO v_last_msg_text, v_last_msg_at
      FROM public.conversations c
      WHERE c.id = ANY(v_all_ids)
        AND (c.last_message_at IS NOT NULL OR c.last_message_text IS NOT NULL)
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC NULLS LAST, c.id DESC
      LIMIT 1;
    END IF;

    -- Preserve most recently touched assigned agent across split threads.
    SELECT c.assigned_agent_id
    INTO v_assigned_agent_id
    FROM public.conversations c
    WHERE c.id = ANY(v_all_ids)
      AND c.assigned_agent_id IS NOT NULL
    ORDER BY
      COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC NULLS LAST,
      c.updated_at DESC NULLS LAST,
      c.id DESC
    LIMIT 1;

    -- Status coherence:
    --   - If the most recent thread was explicitly closed, keep 'closed'.
    --   - Otherwise, if any thread in the group is 'pending' (handoff/pause),
    --     keep 'pending' so a duplicate inbound webhook doesn't drop a pause.
    --   - Otherwise 'open'.
    IF v_latest_status = 'closed' THEN
      v_final_status := 'closed';
    ELSIF EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = ANY(v_all_ids) AND c.status = 'pending'
    ) THEN
      v_final_status := 'pending';
    ELSE
      v_final_status := 'open';
    END IF;

    IF v_final_status = 'pending' THEN
      SELECT
        c.ai_autoreply_disabled,
        c.bot_pause_reason,
        c.bot_paused_at,
        c.bot_resume_after,
        c.bot_handoff_id
      INTO
        v_ai_disabled,
        v_bot_pause_reason,
        v_bot_paused_at,
        v_bot_resume_after,
        v_bot_handoff_id
      FROM public.conversations c
      WHERE c.id = ANY(v_all_ids)
        AND (c.status = 'pending' OR c.ai_autoreply_disabled = true)
      ORDER BY
        (c.bot_pause_reason = 'manual') DESC NULLS LAST,
        COALESCE(c.bot_paused_at, c.last_message_at, c.updated_at, c.created_at) DESC NULLS LAST,
        c.id DESC
      LIMIT 1;

      v_ai_disabled := COALESCE(v_ai_disabled, false);
    ELSE
      SELECT
        c.ai_autoreply_disabled,
        c.bot_pause_reason,
        c.bot_paused_at,
        c.bot_resume_after,
        c.bot_handoff_id
      INTO
        v_ai_disabled,
        v_bot_pause_reason,
        v_bot_paused_at,
        v_bot_resume_after,
        v_bot_handoff_id
      FROM public.conversations c
      WHERE c.id = v_survivor;
    END IF;

    IF v_final_status = 'closed' THEN
      v_ai_reply_count := 0;
    ELSE
      SELECT COALESCE(SUM(COALESCE(c.ai_reply_count, 0)), 0)::INTEGER
      INTO v_ai_reply_count
      FROM public.conversations c
      WHERE c.id = ANY(v_all_ids);
    END IF;

    -- ---- 1) Deduplicate customer `messages` before repointing ----
    -- Required by `messages_customer_meta_id_unique` on
    -- (conversation_id, message_id) WHERE sender_type = 'customer' AND message_id IS NOT NULL.
    FOR v_msg_group IN
      SELECT
        m.message_id,
        array_agg(
          m.id
          ORDER BY
            (m.conversation_id = v_survivor) DESC,
            m.created_at ASC NULLS LAST,
            m.id ASC
        ) AS msg_ids
      FROM public.messages m
      WHERE m.conversation_id = ANY(v_all_ids)
        AND m.sender_type = 'customer'
        AND m.message_id IS NOT NULL
      GROUP BY m.message_id
      HAVING count(*) > 1
    LOOP
      v_keep_msg  := v_msg_group.msg_ids[1];
      v_drop_msgs := v_msg_group.msg_ids[2:array_length(v_msg_group.msg_ids, 1)];

      -- Re-point self-referential replies and flow prompt links.
      UPDATE public.messages
      SET reply_to_message_id = v_keep_msg
      WHERE reply_to_message_id = ANY(v_drop_msgs);

      UPDATE public.flow_runs
      SET last_prompt_message_id = v_keep_msg
      WHERE last_prompt_message_id = ANY(v_drop_msgs);

      -- Re-point message_reactions one dropped message at a time so
      -- `UNIQUE (message_id, actor_type, actor_id)` cannot collide mid-batch.
      FOREACH v_drop_msg IN ARRAY v_drop_msgs
      LOOP
        UPDATE public.message_reactions mr
        SET message_id = v_keep_msg,
            conversation_id = v_survivor
        WHERE mr.message_id = v_drop_msg
          AND NOT EXISTS (
            SELECT 1
            FROM public.message_reactions ex
            WHERE ex.message_id = v_keep_msg
              AND ex.actor_type = mr.actor_type
              AND ex.actor_id IS NOT DISTINCT FROM mr.actor_id
          );

        DELETE FROM public.message_reactions
        WHERE message_id = v_drop_msg;
      END LOOP;

      DELETE FROM public.messages
      WHERE id = ANY(v_drop_msgs);
    END LOOP;

    -- ---- 2) Re-point messages & reactions ---------------------
    UPDATE public.messages
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    UPDATE public.message_reactions
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    -- If survivor had no preview text/timestamp yet, backfill from latest message.
    IF v_last_msg_at IS NULL THEN
      SELECT
        COALESCE(
          NULLIF(m.content_text, ''),
          CASE
            WHEN m.template_name IS NOT NULL THEN 'Template: ' || m.template_name
            ELSE '[' || m.content_type || ']'
          END
        ),
        m.created_at
      INTO v_last_msg_text, v_last_msg_at
      FROM public.messages m
      WHERE m.conversation_id = v_survivor
      ORDER BY m.created_at DESC NULLS LAST, m.id DESC
      LIMIT 1;
    END IF;

    -- ---- 3) Re-point order_drafts (UNIQUE (account_id, conversation_id)) ----
    SELECT d.id
    INTO v_keep_draft
    FROM public.order_drafts d
    WHERE d.conversation_id = ANY(v_all_ids)
    ORDER BY
      (d.processing_message_id IS NOT NULL) DESC,
      (d.state->>'stage' = 'payment_created') DESC,
      (CASE WHEN jsonb_typeof(d.state->'items') = 'array' THEN jsonb_array_length(d.state->'items') ELSE 0 END > 0) DESC,
      d.updated_at DESC NULLS LAST,
      d.id DESC
    LIMIT 1;

    IF v_keep_draft IS NOT NULL THEN
      -- Preserve any losing draft snapshots in order_draft_history before deletion.
      INSERT INTO public.order_draft_history (account_id, conversation_id, state, archived_at)
      SELECT d.account_id, v_survivor, d.state, COALESCE(d.updated_at, now())
      FROM public.order_drafts d
      WHERE d.conversation_id = ANY(v_all_ids)
        AND d.id <> v_keep_draft;

      DELETE FROM public.order_drafts
      WHERE conversation_id = ANY(v_all_ids)
        AND id <> v_keep_draft;

      UPDATE public.order_drafts
      SET conversation_id = v_survivor
      WHERE id = v_keep_draft
        AND conversation_id <> v_survivor;
    END IF;

    -- ---- 4) Re-point all remaining child / referencing tables ----
    UPDATE public.order_draft_history
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    UPDATE public.order_inbound_events
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    UPDATE public.order_message_outbox
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    UPDATE public.deals
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    UPDATE public.flow_runs
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    UPDATE public.notifications
    SET conversation_id = v_survivor
    WHERE conversation_id = ANY(v_losers);

    IF v_has_orders_pay_conv THEN
      UPDATE public.orders
      SET payment_conversation_id = v_survivor
      WHERE payment_conversation_id = ANY(v_losers);
    END IF;

    -- ---- 5) Apply consolidated state on survivor -------------
    UPDATE public.conversations
    SET
      status                = v_final_status,
      unread_count          = v_unread_sum,
      assigned_agent_id     = v_assigned_agent_id,
      last_message_text     = v_last_msg_text,
      last_message_at       = v_last_msg_at,
      ai_autoreply_disabled = v_ai_disabled,
      ai_reply_count        = v_ai_reply_count,
      bot_pause_reason      = v_bot_pause_reason,
      bot_paused_at         = v_bot_paused_at,
      bot_resume_after      = v_bot_resume_after,
      bot_handoff_id        = v_bot_handoff_id,
      last_agent_message_at = v_max_agent_at,
      bot_order_resumed_at  = v_max_resumed_at,
      updated_at            = now()
    WHERE id = v_survivor;

    -- ---- 6) Delete losing duplicates only after full migration ----
    DELETE FROM public.conversations
    WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_conversations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_conversations() TO service_role;

-- Temporarily suppress handoff / assignment notification triggers so
-- historic duplicate consolidation never emits spurious alerts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'prepare_bot_handoff') THEN
    ALTER TABLE public.conversations DISABLE TRIGGER prepare_bot_handoff;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'on_bot_handoff') THEN
    ALTER TABLE public.conversations DISABLE TRIGGER on_bot_handoff;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'on_conversation_assigned') THEN
    ALTER TABLE public.conversations DISABLE TRIGGER on_conversation_assigned;
  END IF;
END $$;

SELECT public.merge_duplicate_conversations();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'prepare_bot_handoff') THEN
    ALTER TABLE public.conversations ENABLE TRIGGER prepare_bot_handoff;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'on_bot_handoff') THEN
    ALTER TABLE public.conversations ENABLE TRIGGER on_bot_handoff;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'on_conversation_assigned') THEN
    ALTER TABLE public.conversations ENABLE TRIGGER on_conversation_assigned;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) Authoritative UNIQUE constraint per (account_id, contact_id)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_unique
  ON public.conversations (account_id, contact_id);

-- ------------------------------------------------------------
-- 3) Atomic RPC: resolve_or_create_conversation
--
-- Safe under concurrent webhook bursts and outbound sends:
-- never raises 23505 or PGRST116, validates account/contact
-- ownership, and returns `{ conversation, is_new }`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_or_create_conversation(
  p_account_id        UUID,
  p_user_id           UUID,
  p_contact_id        UUID,
  p_status            TEXT DEFAULT 'open',
  p_assigned_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_conv       public.conversations;
  v_is_new     BOOLEAN := false;
  v_user_id    UUID;
  v_status     TEXT;
BEGIN
  IF p_account_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'account_id and contact_id are required'
      USING ERRCODE = '22004';
  END IF;

  v_status := COALESCE(NULLIF(p_status, ''), 'open');
  IF v_status NOT IN ('open', 'pending', 'closed') THEN
    RAISE EXCEPTION 'Invalid conversation status: %', v_status
      USING ERRCODE = '22023';
  END IF;

  -- Enforce tenant authorization when invoked by an authenticated CRM user
  -- (matches conversations_insert RLS: account agent+ membership).
  IF auth.uid() IS NOT NULL AND NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Verify the contact belongs to the target account.
  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts ct
    WHERE ct.id = p_contact_id
      AND ct.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Contact does not belong to account'
      USING ERRCODE = '23503';
  END IF;

  -- Resolve NOT NULL audit user_id (prefer caller-provided, fallback to account owner).
  v_user_id := p_user_id;
  IF v_user_id IS NULL THEN
    SELECT a.owner_user_id
    INTO v_user_id
    FROM public.accounts a
    WHERE a.id = p_account_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve audit user_id for account %', p_account_id
      USING ERRCODE = '23502';
  END IF;

  -- Race-free get-or-create loop backed by idx_conversations_account_contact_unique.
  LOOP
    SELECT c.*
    INTO v_conv
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND c.contact_id = p_contact_id
    LIMIT 1;

    IF FOUND THEN
      v_is_new := false;
      EXIT;
    END IF;

    INSERT INTO public.conversations (
      account_id,
      user_id,
      contact_id,
      status,
      assigned_agent_id
    )
    VALUES (
      p_account_id,
      v_user_id,
      p_contact_id,
      v_status,
      p_assigned_agent_id
    )
    ON CONFLICT (account_id, contact_id) DO NOTHING
    RETURNING * INTO v_conv;

    IF FOUND THEN
      v_is_new := true;
      EXIT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'conversation', to_jsonb(v_conv),
    'is_new', v_is_new
  );
END;
$$;

ALTER FUNCTION public.resolve_or_create_conversation(UUID, UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_or_create_conversation(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_conversation(UUID, UUID, UUID, TEXT, UUID) TO authenticated, service_role;

COMMIT;
