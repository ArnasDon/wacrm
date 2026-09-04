-- ============================================================
-- 053_atomic_first_inbound_message
--
-- Bug B1 (WhatsApp webhook audit, follow-up to migration 037) —
-- `isFirstInboundMessage` was computed in application code via a plain
-- `SELECT count(*) FROM messages WHERE conversation_id = X AND
-- sender_type = 'customer'` run BEFORE inserting the inbound message.
--
-- Two DIFFERENT messages from the same brand-new contact, delivered by
-- Meta as two separate webhook calls processed concurrently (each runs
-- in its own `after()` invocation on serverless — there is no shared
-- lock between them), could both read count = 0 before either had
-- inserted. Both then concluded isFirstInboundMessage = true and both
-- fired the `first_inbound_message` automation trigger — a customer
-- writing two quick messages right after first contacting a business
-- (e.g. "Hi" then "Is anyone there?") could get a duplicated welcome
-- automation.
--
-- This mirrors the exact reliability problem migration 037 already
-- solved for the inbound-message idempotency (#367) and for
-- `unread_count` (#369): moving a check-then-act sequence into one
-- atomic, lock-ordered database function instead of leaving it as
-- separate application-level round-trips.
--
-- Audit note: `new_contact_created` (contacts.account_id +
-- phone_normalized unique index, migration 022) and Flows' own
-- `first_inbound_message` entry trigger (`idx_one_active_run_per_contact`
-- partial unique index on flow_runs, migrations 010/017) were already
-- race-free — only this message-count check lacked a DB-level
-- backstop. Neither of those is touched by this migration.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- insert_inbound_customer_message
--
-- Atomically determines whether an inbound customer message is the
-- conversation's first ever, and inserts it — replacing the
-- application's previous three separate round-trips (COUNT, upsert,
-- bump_conversation_on_inbound) with one.
--
-- Correctness hinges on LOCK ORDER: this function takes a row lock on
-- `conversations` (`SELECT ... FOR UPDATE`) BEFORE counting prior
-- customer messages. A concurrent call for the SAME conversation_id
-- blocks at that lock acquisition until this transaction commits (or
-- rolls back) — there is no window in which two callers can both
-- observe the pre-insert count:
--
--   Webhook A: LOCK conversation → COUNT = 0 → INSERT msg A → COMMIT
--   Webhook B: (blocks on the lock until A commits)
--              LOCK conversation → COUNT = 1 → INSERT msg B → COMMIT
--
--   Result: A → is_first_customer_message = true
--           B → is_first_customer_message = false
--   (which one is A vs B is whichever call's transaction starts
--   first — the property that matters is that EXACTLY ONE is true.)
--
-- Idempotency is preserved exactly: `ON CONFLICT (conversation_id,
-- message_id) DO NOTHING` (the same unique index migration 037 added)
-- means a replayed Meta delivery (identical message_id) inserts
-- nothing and reports was_inserted = false / is_first_customer_message
-- = false, without taking the unread-count bump below — the same
-- outcome the old code's early return produced.
--
-- The unread-count / last-message bump on a genuine insert reuses
-- `bump_conversation_on_inbound` (migration 037) verbatim — called
-- from inside this function's own transaction, so it runs under the
-- same lock already held above, rather than duplicating its UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION public.insert_inbound_customer_message(
  p_conversation_id      UUID,
  p_message_id           TEXT,
  p_content_type         TEXT,
  p_content_text         TEXT,
  p_media_url            TEXT,
  p_media_type           TEXT,
  p_created_at           TIMESTAMPTZ,
  p_reply_to_message_id  UUID,
  p_interactive_reply_id TEXT,
  p_last_message_text    TEXT
)
RETURNS TABLE(
  message_id                 UUID,
  was_inserted                BOOLEAN,
  is_first_customer_message   BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id  UUID;
  v_prior_count BIGINT;
BEGIN
  -- Lock the conversation FIRST, before the count below. A concurrent
  -- call for the same conversation_id waits right here until this
  -- transaction ends — that ordering is the entire fix.
  PERFORM 1 FROM conversations WHERE id = p_conversation_id FOR UPDATE;

  SELECT count(*) INTO v_prior_count
  FROM messages
  WHERE conversation_id = p_conversation_id
    AND sender_type = 'customer';

  -- Idempotent insert — identical column set and ON CONFLICT target to
  -- the application code it replaces. `status` is always 'delivered'
  -- for an inbound customer message (unchanged literal, matching the
  -- previous upsert).
  INSERT INTO messages (
    conversation_id, sender_type, content_type, content_text,
    media_url, media_type, message_id, status, created_at,
    reply_to_message_id, interactive_reply_id
  ) VALUES (
    p_conversation_id, 'customer', p_content_type, p_content_text,
    p_media_url, p_media_type, p_message_id, 'delivered', p_created_at,
    p_reply_to_message_id, p_interactive_reply_id
  )
  ON CONFLICT (conversation_id, message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  -- Replayed delivery (this exact message_id already exists in this
  -- conversation): nothing was inserted, so there is nothing to bump
  -- and nothing to report as "first" — matches the old code's early
  -- return on an empty upsert result.
  IF v_message_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, FALSE;
    RETURN;
  END IF;

  -- Same bump the caller used to trigger via a second RPC round-trip
  -- (bump_conversation_on_inbound, migration 037) — now inside this
  -- function's transaction, still covered by the lock taken above.
  -- Left completely unmodified; called, not duplicated.
  PERFORM public.bump_conversation_on_inbound(p_conversation_id, p_last_message_text);

  RETURN QUERY SELECT v_message_id, TRUE, (v_prior_count = 0);
END;
$$;

-- Only the service role (webhook) calls this — same lockdown pattern
-- as bump_conversation_on_inbound / create_broadcast_with_recipients.
REVOKE ALL ON FUNCTION public.insert_inbound_customer_message(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_inbound_customer_message(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.insert_inbound_customer_message(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_inbound_customer_message(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) TO service_role;
