-- ============================================================
-- 041_deal_assignment
--
-- Notify a teammate when a deal is assigned to them — the deal-side
-- counterpart to `notify_conversation_assigned` (migration 027).
--
-- Two differences from that trigger, both from how the two tables are
-- shaped:
--
--   1. `conversations.assigned_agent_id` stores an `auth.users.id`
--      directly, so that trigger uses NEW.assigned_agent_id as
--      notifications.user_id as-is. `deals.assigned_to` instead
--      references `profiles(id)` (migration 002), so this trigger
--      resolves it to the assignee's `profiles.user_id` first — that's
--      the id `notifications.user_id` (an auth.users FK) actually needs.
--
--   2. No `deal_id` column is added to `notifications`. The click
--      handler on the Notifications page already deep-links via
--      `conversation_id` when present and otherwise just marks the row
--      read without navigating (see notifications/page.tsx) — this
--      trigger reuses that existing column when the deal happens to
--      have a linked conversation, rather than growing the schema for
--      a dedicated deals deep-link.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'deal_assigned'));

CREATE OR REPLACE FUNCTION notify_deal_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignee_user_id UUID;
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_to IS NULL
       OR NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assigned_to;
  -- assigned_to pointing at no resolvable profile (stale FK, cross-account
  -- data) — nothing sane to notify.
  IF v_assignee_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = v_assignee_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
    FROM contacts WHERE id = NEW.contact_id;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    v_assignee_user_id,
    'deal_assigned',
    NEW.conversation_id,
    NEW.contact_id,
    auth.uid(),
    'New deal assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a deal: ' ||
      COALESCE(NULLIF(NEW.title, ''), 'Untitled deal') ||
      CASE WHEN v_contact_name IS NOT NULL THEN ' (' || v_contact_name || ')' ELSE '' END
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create deal-assignment notification for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_deal_assigned() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_assigned ON deals;
CREATE TRIGGER on_deal_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_deal_assigned();
