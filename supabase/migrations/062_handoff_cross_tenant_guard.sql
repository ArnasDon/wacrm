-- ============================================================
-- 062_handoff_cross_tenant_guard.sql — Punto 9 audit, hallazgo H9-1.
--
-- PROBLEM: two columns can end up written into
-- `conversations.assigned_agent_id` without ever being checked against
-- the CONVERSATION's own `account_id`:
--
--   - `account_business_contacts.linked_user_id` (migration 050) —
--     validated at the application layer as of this same change
--     (src/app/api/ai/business-profile/contacts/route.ts + [id]/route.ts),
--     but had NO check at all before it, and nothing in the database
--     ever enforced it either.
--   - `conversations.assigned_agent_id` itself (migration 001) has no
--     FK/CHECK of any kind — any write path (a future one included)
--     could set it to an arbitrary UUID.
--
-- A conversation assigned to a user outside its own account fires
-- `on_conversation_assigned` (migration 027), which inserts a row into
-- `notifications` addressed to that user — and `notifications_select`
-- only checked `auth.uid() = user_id`, with no account check at all, so
-- that stranger could actually read the resulting notification (the
-- contact's name + the fact of the assignment), a real cross-tenant
-- information leak.
--
-- FIX — defense in depth, three independent layers:
--
--   1. STRUCTURAL (this migration): `profiles.user_id` has been
--      globally UNIQUE since migration 001, so `UNIQUE(account_id,
--      user_id)` on `profiles` can never fail against existing data —
--      it is implied by the constraint that already exists. That composite
--      key lets two REAL, structural foreign keys exist:
--        conversations(account_id, assigned_agent_id)
--          REFERENCES profiles(account_id, user_id)
--        account_business_contacts(account_id, linked_user_id)
--          REFERENCES profiles(account_id, user_id)
--      Postgres's default MATCH SIMPLE means a NULL assigned_agent_id/
--      linked_user_id is never checked (both stay fully optional,
--      exactly as before) — the constraint only ever fires when a real
--      user id is being written, and then it can ONLY be a member of
--      that exact row's own account. This covers every write path
--      uniformly (handoff, the inbox's manual assign dropdown,
--      automations' assign_conversation step, and any future one) —
--      not just the two application routes hardened alongside it.
--
--   2. APPLICATION (same change, different files): the contacts
--      create/update routes and handOffToHuman() (src/lib/ai/
--      auto-reply.ts) now verify membership BEFORE attempting a write,
--      via the new business-profile/service.ts::isAccountMember()
--      helper — this is what turns a rejected write into a clean 400 /
--      a graceful fallback instead of a raw FK-violation error reaching
--      the customer-facing auto-reply path.
--
--   3. RLS (this migration): notifications_select/notifications_update
--      now ALSO require is_account_member(account_id), on top of the
--      existing auth.uid() = user_id check — defense in depth for any
--      OTHER, currently-unforeseen path that might someday insert into
--      notifications, independent of whether the FKs above hold.
--
-- notify_conversation_assigned() (migration 027) itself is intentionally
-- left untouched: it is an AFTER trigger, and the new assigned_agent_id
-- FK (a BEFORE-the-row-exists check enforced by Postgres on the same
-- statement) already guarantees NEW.assigned_agent_id belongs to
-- NEW.account_id by the time this AFTER trigger ever sees the row —
-- adding a second, redundant check inside it would protect nothing the
-- FK doesn't already.
--
-- ─── On existing data ───────────────────────────────────────────
-- If a `conversations.assigned_agent_id` or `account_business_contacts.
-- linked_user_id` already points to a user outside that row's own
-- account, the FK additions below FAIL LOUDLY (mirroring migration
-- 013's own precedent) rather than silently dropping or reassigning
-- anything. Each pre-check reports the exact count and the affected
-- row ids/account ids so an operator can decide, per row, whether to
-- null the field out or correct the account — never done automatically
-- by this migration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles(account_id, user_id) — composite unique key the two FKs
--    below reference. Cannot fail against existing data: user_id has
--    been globally UNIQUE on this table since migration 001, so no two
--    rows can ever collide on (account_id, user_id) either.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_account_id_user_id_key'
      AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_account_id_user_id_key UNIQUE (account_id, user_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. conversations.assigned_agent_id — pre-check, then FK.
-- ------------------------------------------------------------
DO $$
DECLARE
  conflict_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM conversations c
  WHERE c.assigned_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = c.assigned_agent_id AND p.account_id = c.account_id
    );

  IF conflict_count > 0 THEN
    SELECT string_agg(
      'conversation ' || id::text || ' (account ' || account_id::text || ' -> assigned_agent_id ' || assigned_agent_id::text || ')',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT id, account_id, assigned_agent_id
      FROM conversations c
      WHERE c.assigned_agent_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.user_id = c.assigned_agent_id AND p.account_id = c.account_id
        )
      LIMIT 10
    ) sample_rows;

    RAISE EXCEPTION
      E'Cannot add FK conversations(account_id, assigned_agent_id) -> profiles(account_id, user_id) — % conversation(s) are assigned to a user outside their own account (Punto 9, H9-1):\n  %\nFor each one, either clear assigned_agent_id (UPDATE conversations SET assigned_agent_id = NULL WHERE id = ...) or correct the assignment to a real member of that account, then re-run migrations.',
      conflict_count,
      sample;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_assigned_agent_account_fkey'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_assigned_agent_account_fkey
      FOREIGN KEY (account_id, assigned_agent_id)
      REFERENCES profiles (account_id, user_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. account_business_contacts.linked_user_id — pre-check, then FK.
-- ------------------------------------------------------------
DO $$
DECLARE
  conflict_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM account_business_contacts c
  WHERE c.linked_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = c.linked_user_id AND p.account_id = c.account_id
    );

  IF conflict_count > 0 THEN
    SELECT string_agg(
      'contact ' || id::text || ' (account ' || account_id::text || ' -> linked_user_id ' || linked_user_id::text || ')',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT id, account_id, linked_user_id
      FROM account_business_contacts c
      WHERE c.linked_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.user_id = c.linked_user_id AND p.account_id = c.account_id
        )
      LIMIT 10
    ) sample_rows;

    RAISE EXCEPTION
      E'Cannot add FK account_business_contacts(account_id, linked_user_id) -> profiles(account_id, user_id) — % contact(s) are linked to a user outside their own account (Punto 9, H9-1):\n  %\nFor each one, either clear linked_user_id (UPDATE account_business_contacts SET linked_user_id = NULL WHERE id = ...) or correct it to a real member of that account, then re-run migrations.',
      conflict_count,
      sample;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_business_contacts_linked_user_account_fkey'
      AND conrelid = 'account_business_contacts'::regclass
  ) THEN
    ALTER TABLE account_business_contacts
      ADD CONSTRAINT account_business_contacts_linked_user_account_fkey
      FOREIGN KEY (account_id, linked_user_id)
      REFERENCES profiles (account_id, user_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. notifications RLS — require account membership IN ADDITION TO
--    being the addressed recipient. Strictly narrows the previously
--    visible set (AND, never OR) — a legitimate same-account recipient
--    loses nothing; a row whose user_id/account_id pair could never
--    legitimately coexist (H9-1) is no longer readable/markable by
--    anyone, regardless of how it was created.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (auth.uid() = user_id AND is_account_member(account_id));

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (auth.uid() = user_id AND is_account_member(account_id))
  WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));
