-- ============================================================
-- 102_assignment_and_sla.sql — SLA Badge & Assignment Audit
--
-- F1/F2: Response SLA tracker (first_unanswered_at)
-- F3: Assignment History audit table
-- ============================================================

-- 1) SLA Tracking on conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS first_unanswered_at TIMESTAMPTZ;

-- Trigger to maintain first_unanswered_at
CREATE OR REPLACE FUNCTION update_conversation_sla()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_type = 'customer' THEN
      UPDATE conversations 
      SET first_unanswered_at = COALESCE(first_unanswered_at, NEW.created_at)
      WHERE id = NEW.conversation_id;
    ELSIF NEW.sender_type IN ('agent', 'bot') THEN
      UPDATE conversations
      SET first_unanswered_at = NULL
      WHERE id = NEW.conversation_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_sla ON messages;
CREATE TRIGGER trigger_update_sla
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_sla();

-- 2) Assignment History
CREATE TABLE IF NOT EXISTS assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  from_agent_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  actor_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_history_account ON assignment_history(account_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_contact ON assignment_history(contact_id);

ALTER TABLE assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_history_select ON assignment_history;
CREATE POLICY assignment_history_select ON assignment_history FOR SELECT
  USING (is_account_member(account_id));

-- Typically, assignment_history is insert-only (no update/delete)
DROP POLICY IF EXISTS assignment_history_insert ON assignment_history;
CREATE POLICY assignment_history_insert ON assignment_history FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Trigger to capture assignment changes from conversations
CREATE OR REPLACE FUNCTION log_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_account_id UUID;
  v_actor_id UUID;
  v_reason TEXT;
BEGIN
  IF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    -- Look up account_id and actor
    SELECT account_id INTO v_account_id FROM contacts WHERE id = NEW.contact_id;
    v_actor_id := auth.uid();
    
    IF v_actor_id IS NULL THEN
      v_reason := 'automation';
    ELSE
      v_reason := 'manual';
    END IF;

    INSERT INTO assignment_history (
      account_id, 
      contact_id, 
      from_agent_id, 
      to_agent_id, 
      actor_id, 
      reason
    ) VALUES (
      v_account_id,
      NEW.contact_id,
      OLD.assigned_agent_id,
      NEW.assigned_agent_id,
      v_actor_id,
      v_reason
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_log_assignment ON conversations;
CREATE TRIGGER trigger_log_assignment
AFTER UPDATE OF assigned_agent_id ON conversations
FOR EACH ROW
EXECUTE FUNCTION log_conversation_assignment();
