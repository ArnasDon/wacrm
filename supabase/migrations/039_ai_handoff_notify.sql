-- ============================================================
-- Notify agents when the AI bot hands a conversation off to a human.
--
-- `dispatchInboundToAiReply` (src/lib/ai/auto-reply.ts) already sets
-- `ai_handoff_summary` + (optionally) `assigned_agent_id` in one UPDATE
-- when the bot bails. Today that only produces a notification when a
-- specific handoff agent is configured — routing to the shared queue
-- (`handoff_agent_id` unset) leaves `assigned_agent_id` NULL, so the
-- existing `on_conversation_assigned` trigger never fires and nobody
-- is told the bot needs a human.
-- ============================================================

-- Allow the new notification type used for the queue-broadcast case.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_handoff'));

-- Enrich the assignment notification with the handoff note when the
-- assignment happened as part of the same handoff UPDATE, so the agent
-- who gets pinged sees *why* immediately instead of a bare "assigned".
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_is_handoff BOOLEAN;
  v_body TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_is_handoff := NEW.ai_handoff_summary IS NOT NULL;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
    v_is_handoff := NEW.ai_handoff_summary IS NOT NULL
      AND NEW.ai_handoff_summary IS DISTINCT FROM OLD.ai_handoff_summary;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  IF v_is_handoff THEN
    v_body := NEW.ai_handoff_summary;
  ELSE
    v_body := COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact');
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    CASE WHEN v_is_handoff THEN 'ai_handoff' ELSE 'conversation_assigned' END,
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    CASE WHEN v_is_handoff THEN 'AI handed off a conversation to you' ELSE 'New conversation assigned' END,
    v_body
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;

-- ============================================================
-- TRIGGER — notify the whole account when the bot hands off to the
-- shared queue (no specific agent assigned, so the trigger above never
-- fires for this case).
-- ============================================================
CREATE OR REPLACE FUNCTION notify_ai_handoff_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
BEGIN
  -- Only the queue case: a specific assignee is covered by
  -- `notify_conversation_assigned` in the same UPDATE.
  IF NEW.assigned_agent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.ai_handoff_summary IS NULL
     OR NEW.ai_handoff_summary IS NOT DISTINCT FROM OLD.ai_handoff_summary THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id, title, body
  )
  SELECT
    NEW.account_id,
    p.user_id,
    'ai_handoff',
    NEW.id,
    NEW.contact_id,
    'AI handed off a conversation with ' || COALESCE(v_contact_name, 'a contact'),
    NEW.ai_handoff_summary
  FROM profiles p
  WHERE p.account_id = NEW.account_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create queue handoff notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_ai_handoff_queue() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_ai_handoff_queue ON conversations;
CREATE TRIGGER on_ai_handoff_queue
  AFTER UPDATE OF ai_handoff_summary ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_ai_handoff_queue();
