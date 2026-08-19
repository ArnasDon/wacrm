-- ============================================================
-- 040_conversation_visibility.sql — per-member conversation scope
--
-- What this adds
--
--   `profiles.can_view_all_conversations` — a per-member boolean,
--   default TRUE, that an admin+ toggles from Settings → Members.
--
--     TRUE  (default) — the member sees every conversation in the
--                       account. This is the pre-040 behaviour, so
--                       existing installs are unchanged on upgrade.
--     FALSE           — the member sees only the conversations whose
--                       `assigned_agent_id` is them.
--
--   Owners and admins are exempt: they always see everything, flag
--   or not. A team lead can't be locked out of their own inbox by
--   a stray toggle, and the flag only ever *narrows* an agent or
--   viewer.
--
-- Why RLS and not a `.eq()` in the inbox query
--
--   The conversation list, the unread badge, the dashboard charts
--   and the realtime channel all read `conversations` directly
--   from the browser with the user's JWT. A client-side filter on
--   one of them is a UI preference, not a boundary — the other
--   three would still leak, and so would a hand-rolled PostgREST
--   call. Putting the rule in the SELECT policy makes every one of
--   those paths obey it with no app change.
--
-- Cascade
--
--   A conversation you cannot see must not leak through its
--   children either, so `messages` and `message_reactions` are
--   re-gated on the same predicate rather than on bare account
--   membership.
--
-- Unassigned threads
--
--   `assigned_agent_id IS NULL` means "nobody's" — a restricted
--   member does NOT see it. Inbound messages from a new customer
--   land unassigned, so on a team where everyone is restricted,
--   someone with full access has to route the thread before an
--   agent can work it. That is the intended shape of the feature
--   (a restricted agent has a queue, not an inbox), but it is the
--   behaviour to explain first when someone reports "my agent
--   sees nothing".
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The column
--
-- NOT NULL DEFAULT TRUE so every existing row (and every future
-- signup / invite redemption, neither of which sets the column)
-- starts unrestricted. Restriction is always an explicit act.
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_view_all_conversations BOOLEAN NOT NULL DEFAULT TRUE;

-- The RLS predicate below reads (account_id, assigned_agent_id) on
-- every conversation row it considers. `idx_conversations_account`
-- from 017 covers the first half; this covers the "my queue" scan a
-- restricted member's inbox becomes.
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent
  ON conversations(account_id, assigned_agent_id);

-- ------------------------------------------------------------
-- 2. Close the self-service escalation hole
--
-- `profiles_update` (017) lets a user update their own row, and
-- RLS gates rows, not columns — so without this, a restricted
-- agent lifts their own restriction with a single PATCH:
--
--   PATCH /rest/v1/profiles?user_id=eq.<self>
--     { "can_view_all_conversations": true }
--
-- 034 already installed a BEFORE UPDATE trigger for exactly this
-- class of column (account_role, account_id). Extend it rather
-- than adding a second trigger, so there is one place to look.
-- The discriminator is unchanged: `current_user = 'authenticated'`
-- is the browser; the SECURITY DEFINER RPCs run as `postgres` and
-- the backend as `service_role`, so both still write freely.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.can_view_all_conversations IS DISTINCT FROM OLD.can_view_all_conversations)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id and can_view_all_conversations cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

-- 034 created the trigger; recreate it so a database that somehow
-- lost it (or applied 040 standalone) still ends up guarded.
DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ------------------------------------------------------------
-- 3. The predicate helpers
--
-- `has_full_conversation_access` is SECURITY DEFINER for the same
-- reason `is_account_member` is: the policy body reads `profiles`,
-- and doing that under the caller's own RLS would recurse.
--
-- Kept separate from `is_account_member` rather than folded into
-- it — membership ("are you in this tenant") and scope ("how much
-- of it do you see") are different questions, and every other
-- table's policies want only the first one.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_full_conversation_access(
  target_account_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        -- Owners and admins are never scoped down.
        p.account_role IN ('owner', 'admin')
        OR p.can_view_all_conversations
      )
  );
$$;

ALTER FUNCTION public.has_full_conversation_access(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.has_full_conversation_access(UUID)
  TO authenticated, service_role;

-- Row-level verdict for one conversation. Takes the two columns
-- rather than an id so the policies can call it on the row being
-- evaluated without a self-join back into `conversations`.
--
-- The explicit IS NOT NULL matters: `NULL = auth.uid()` is NULL,
-- and `false OR NULL` is NULL, which a policy treats as a fail.
-- That happens to be the outcome we want for an unassigned thread,
-- but relying on three-valued logic to land on the right answer is
-- how the next person introduces a bug here.
CREATE OR REPLACE FUNCTION public.can_access_conversation(
  p_account_id UUID,
  p_assigned_agent_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT has_full_conversation_access(p_account_id)
      OR (p_assigned_agent_id IS NOT NULL AND p_assigned_agent_id = auth.uid());
$$;

ALTER FUNCTION public.can_access_conversation(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(UUID, UUID)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Keep a restricted member's own new threads visible
--
-- `POST /api/whatsapp/send` with a `contact_id` find-or-creates a
-- conversation under the caller's RLS. A restricted member would
-- insert an unassigned row and then immediately fail to read it
-- back — their own outbound message vanishing into a thread they
-- cannot open.
--
-- Auto-assigning at the trigger level (rather than in the send
-- route) means every current and future insert path gets it, and
-- the INSERT policy below can safely demand visibility. BEFORE
-- triggers run before WITH CHECK is evaluated, so the policy sees
-- the assigned row.
--
-- Service-role writers (the Meta webhook) have no `auth.uid()`, so
-- inbound threads still arrive unassigned as before.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_conversation_to_restricted_creator()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL
     AND auth.uid() IS NOT NULL
     AND NOT has_full_conversation_access(NEW.account_id)
  THEN
    NEW.assigned_agent_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.assign_conversation_to_restricted_creator() OWNER TO postgres;

DROP TRIGGER IF EXISTS assign_conversation_to_restricted_creator ON public.conversations;
CREATE TRIGGER assign_conversation_to_restricted_creator
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.assign_conversation_to_restricted_creator();

-- ------------------------------------------------------------
-- 5. Re-gate conversations
--
-- Same tiering as 017 (viewer reads, agent+ writes) with the scope
-- predicate ANDed on. UPDATE gets an explicit WITH CHECK that is
-- *looser* than its USING: a restricted agent may hand a thread
-- off to a teammate, which necessarily produces a row they can no
-- longer see. Without the explicit clause Postgres reuses USING as
-- the check and the handoff fails.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;

CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id)
  AND can_access_conversation(account_id, assigned_agent_id)
);
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
  AND can_access_conversation(account_id, assigned_agent_id)
);
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_conversation(account_id, assigned_agent_id)
  )
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  is_account_member(account_id, 'agent')
  AND can_access_conversation(account_id, assigned_agent_id)
);

-- ------------------------------------------------------------
-- 6. Cascade to messages and reactions
--
-- Identical to the 017 policies except the parent check is now
-- "can I access this conversation" instead of "am I in this
-- account". Without this a restricted agent still reads the whole
-- account's message history by querying `messages` directly.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;

CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id)
      AND can_access_conversation(c.account_id, c.assigned_agent_id)
  )
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_conversation(c.account_id, c.assigned_agent_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_conversation(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
DROP POLICY IF EXISTS message_reactions_modify ON message_reactions;

CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id)
      AND can_access_conversation(c.account_id, c.assigned_agent_id)
  )
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_conversation(c.account_id, c.assigned_agent_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_conversation(c.account_id, c.assigned_agent_id)
  )
);

-- ------------------------------------------------------------
-- 7. The supervised writer
--
-- Mirrors `set_member_role` from 018 exactly — same authority
-- checks, same SQLSTATE contract (42501 → 403, 22023 → 400) that
-- `rpcErrorToResponse` in the members route already maps.
--
-- Self-targeting is blocked for the same reason it is on roles: an
-- admin toggling their own flag would be a no-op (admins are
-- exempt) that looks like it did something.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_conversation_access(
  p_user_id UUID,
  p_can_view_all BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_can_view_all IS NULL THEN
    RAISE EXCEPTION 'can_view_all_conversations must be true or false'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own conversation access'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id
  INTO v_target_account_id
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET can_view_all_conversations = p_can_view_all
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_conversation_access(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_conversation_access(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_conversation_access(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- Manual validation (no automated SQL test harness in this repo):
--
--   1. As an agent JWT with can_view_all_conversations = false,
--      GET /rest/v1/conversations returns only rows where
--      assigned_agent_id = that user. GET /rest/v1/messages
--      returns only that subset's messages.
--   2. Flipping the flag back to true restores the full list with
--      no app deploy.
--   3. PATCH /rest/v1/profiles?user_id=eq.<self>
--        { "can_view_all_conversations": true }
--      must return 42501 (the 034 trigger, extended above).
--   4. An owner/admin with the flag set false still sees every
--      conversation (the role exemption).
--   5. A restricted agent sending to a brand-new contact via
--      POST /api/whatsapp/send { contact_id } gets a thread they
--      can still open afterwards (the BEFORE INSERT trigger).
-- ============================================================
