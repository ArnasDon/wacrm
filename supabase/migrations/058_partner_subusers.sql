-- ============================================================
-- 058_partner_subusers.sql — Partner (SubUser) invitations
--
-- A "Partner" is a SubUser: a normal wacrm user created from an
-- emailed invitation sent by a Main User. Both log in through the
-- same /login page and use the same dashboard; the only difference
-- is that SubUsers cannot reach the Partners module.
--
--   Main User:  profiles.role = 'User',    parent_user_id = NULL
--   SubUser:    profiles.role = 'SubUser', parent_user_id = <Main User>
--
-- What this migration does
--   1. Repurposes the legacy, unused `profiles.role TEXT` column
--      (see 017's header) as the User/SubUser discriminator. Every
--      existing row becomes 'User'; a CHECK pins the two values.
--   2. Adds `profiles.parent_user_id` and `profiles.status`
--      ('ACTIVE' | 'DISABLED').
--   3. Extends the 034 privilege-column guard so the browser client
--      cannot change role / parent_user_id / status (nor seed them on
--      INSERT). Only SECURITY DEFINER RPCs and the service role can.
--   4. Makes `is_account_member()` require status = 'ACTIVE', so a
--      DISABLED user loses every membership-gated RLS policy — the
--      database itself refuses their CRM reads and writes.
--   5. Creates `partner_invitations` (token stored as SHA-256 hash).
--   6. Allows the 'partner_registered' notification type.
--   7. Adds service-role-only RPCs:
--        accept_partner_invitation  — the signup transaction
--        resend_partner_invitation  — atomic token rotation + rate limit
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1–2. PROFILES: role / parent_user_id / status
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS parent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';

-- Legacy values were 'user' (the 001 default) or NULL. Anything that
-- is not already a SubUser is a Main User.
UPDATE profiles SET role = 'User'
WHERE role IS DISTINCT FROM 'User' AND role IS DISTINCT FROM 'SubUser';

ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'User';
ALTER TABLE profiles ALTER COLUMN role SET NOT NULL;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('User', 'SubUser'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('ACTIVE', 'DISABLED'));

-- A Main User never has a parent. (A SubUser's parent may become NULL
-- if the Main User's auth row is deleted — ON DELETE SET NULL — so the
-- converse is not enforced.)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_main_user_no_parent;
ALTER TABLE profiles ADD CONSTRAINT profiles_main_user_no_parent
  CHECK (role <> 'User' OR parent_user_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_profiles_parent_user_id
  ON profiles(parent_user_id)
  WHERE parent_user_id IS NOT NULL;

-- Duplicate-account checks look profiles up by email.
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON profiles(lower(email));

-- ============================================================
-- 3. PRIVILEGE-COLUMN GUARD (extends 034)
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A self-inserted profile (profiles_insert policy) is always a
    -- plain, active Main User. Never trust client-supplied values.
    NEW.role := 'User';
    NEW.parent_user_id := NULL;
    NEW.status := 'ACTIVE';
    RETURN NEW;
  END IF;

  IF NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
  THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.parent_user_id IS DISTINCT FROM OLD.parent_user_id
     OR NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION
      'role, parent_user_id and status cannot be changed directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ============================================================
-- 4. MEMBERSHIP HELPER — disabled users are members of nothing
--
-- Same signature and body as 017, plus `p.status = 'ACTIVE'`. Every
-- tenant table's RLS policy funnels through this function, so a
-- DISABLED SubUser is denied at the database layer even while an
-- access token issued before the disable is still unexpired.
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
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
      AND p.status = 'ACTIVE'
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- 5. PARTNER_INVITATIONS
--
-- One row per invited partner. The row stays after signup as the
-- link between the Main User and the SubUser it produced
-- (`created_user_id`), which is what the Partners page lists.
--
-- `token_hash` is SHA-256 of a 32-byte CSPRNG token; the plaintext
-- only ever exists in the emailed link. Resending rotates the hash,
-- which invalidates every earlier link.
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_sent_at TIMESTAMPTZ,
  -- Fixed-window resend limiter, updated atomically by
  -- resend_partner_invitation() so it holds across app instances.
  resend_count INTEGER NOT NULL DEFAULT 0,
  resend_window_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_invitations_email_lower CHECK (email = lower(email)),
  CONSTRAINT partner_invitations_accepted_has_user
    CHECK (status <> 'ACCEPTED' OR used_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_invitations_token_hash
  ON partner_invitations(token_hash);

-- Partners page: "my invitations, newest first".
CREATE INDEX IF NOT EXISTS idx_partner_invitations_parent_created
  ON partner_invitations(parent_user_id, created_at DESC);

-- At most one live invitation per email address across the whole
-- instance — an email can only ever become one account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_invitations_one_pending_per_email
  ON partner_invitations(email)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_partner_invitations_created_user
  ON partner_invitations(created_user_id)
  WHERE created_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON partner_invitations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON partner_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: a Main User may read their own rows (defense in depth — the
-- app reads through the server with explicit parent filters). There
-- are no client write policies: every write goes through the API
-- routes (service role) or the RPCs below.
ALTER TABLE partner_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_invitations_select ON partner_invitations;
CREATE POLICY partner_invitations_select ON partner_invitations FOR SELECT
  USING (
    parent_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'User' AND p.status = 'ACTIVE'
    )
  );

-- ============================================================
-- 6. NOTIFICATIONS: allow 'partner_registered'
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'partner_registered'));

-- ============================================================
-- 7a. accept_partner_invitation — the signup transaction
--
-- Called by POST /api/partner-invitations/signup right after the
-- server has created the auth user (Supabase Auth owns auth.users
-- and bcrypt-hashes the password; its trigger `handle_new_user`
-- has already created a profile + personal account for that user).
--
-- Everything below runs in ONE transaction — any RAISE rolls all of
-- it back and the route then deletes the just-created auth user, so
-- no partial SubUser is ever left behind.
--
-- role / parent_user_id are NOT parameters: they come from the
-- locked invitation row, never from the caller.
--
-- SQLSTATEs (mapped to HTTP by the route):
--   P0002  invitation not found            → 404
--   22023  expired / used / revoked / bad  → 410 / 409 / 400
--   23505  email already has an account    → 409
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_partner_invitation(
  p_token_hash TEXT,
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv partner_invitations%ROWTYPE;
  v_profile profiles%ROWTYPE;
  v_parent profiles%ROWTYPE;
  v_full_name TEXT;
BEGIN
  -- Lock the invitation: two concurrent signups on the same token
  -- serialise here, and the loser sees status = 'ACCEPTED'.
  SELECT * INTO v_inv
  FROM partner_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.status = 'ACCEPTED' THEN
    RAISE EXCEPTION 'invitation_used' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'REVOKED' THEN
    RAISE EXCEPTION 'invitation_revoked' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'EXPIRED' OR v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '22023';
  END IF;

  -- The parent must still be an active Main User.
  SELECT * INTO v_parent FROM profiles WHERE user_id = v_inv.parent_user_id;
  IF NOT FOUND OR v_parent.role <> 'User' OR v_parent.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'invitation_revoked' USING ERRCODE = '22023';
  END IF;

  -- The profile handle_new_user just created for the new auth user.
  SELECT * INTO v_profile FROM profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_missing' USING ERRCODE = '22023';
  END IF;
  IF lower(v_profile.email) <> v_inv.email THEN
    RAISE EXCEPTION 'email_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Duplicate-account guard: nobody else may already own this email.
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE lower(email) = v_inv.email AND user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'account_exists' USING ERRCODE = '23505';
  END IF;

  v_full_name := btrim(btrim(p_first_name) || ' ' || btrim(p_last_name));

  UPDATE profiles
  SET role = 'SubUser',
      parent_user_id = v_inv.parent_user_id,
      status = 'ACTIVE',
      full_name = v_full_name
  WHERE user_id = p_user_id;

  -- The SubUser's personal workspace is named after their company.
  UPDATE accounts
  SET name = v_inv.company_name
  WHERE id = v_profile.account_id AND owner_user_id = p_user_id;

  UPDATE partner_invitations
  SET status = 'ACCEPTED',
      used_at = NOW(),
      created_user_id = p_user_id
  WHERE id = v_inv.id;

  -- Notify the Main User through the existing notifications feed.
  -- Unlike the assignment trigger this is NOT wrapped in an
  -- exception handler: the spec makes it part of the transaction.
  INSERT INTO notifications (
    account_id, user_id, type, actor_user_id, title, body
  ) VALUES (
    v_parent.account_id,
    v_inv.parent_user_id,
    'partner_registered',
    p_user_id,
    'New Partner Registered',
    v_inv.company_name || ' / ' || v_full_name || ' has successfully completed signup.'
  );

  RETURN jsonb_build_object(
    'invitation_id', v_inv.id,
    'parent_user_id', v_inv.parent_user_id,
    'user_id', p_user_id
  );
END;
$$;

ALTER FUNCTION public.accept_partner_invitation(TEXT, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_partner_invitation(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_partner_invitation(TEXT, UUID, TEXT, TEXT) TO service_role;

-- ============================================================
-- 7b. resend_partner_invitation — rotate token + rate limit
--
-- Single atomic UPDATE so the fixed-window limiter cannot be raced
-- past its budget by parallel clicks. Ownership is part of the WHERE
-- clause: a caller can only ever touch their own invitation.
--
-- Returns { outcome: 'ok' | 'not_found' | 'not_resendable' |
--           'rate_limited', retry_after_seconds? }
-- ============================================================
CREATE OR REPLACE FUNCTION public.resend_partner_invitation(
  p_invitation_id UUID,
  p_parent_user_id UUID,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_limit INTEGER,
  p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv partner_invitations%ROWTYPE;
  v_window INTERVAL := make_interval(secs => p_window_seconds);
BEGIN
  SELECT * INTO v_inv
  FROM partner_invitations
  WHERE id = p_invitation_id AND parent_user_id = p_parent_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_inv.status NOT IN ('PENDING', 'EXPIRED') THEN
    RETURN jsonb_build_object('outcome', 'not_resendable', 'status', v_inv.status);
  END IF;

  IF v_inv.resend_window_started_at IS NOT NULL
     AND v_inv.resend_window_started_at > NOW() - v_window
     AND v_inv.resend_count >= p_limit
  THEN
    RETURN jsonb_build_object(
      'outcome', 'rate_limited',
      'retry_after_seconds',
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM
        (v_inv.resend_window_started_at + v_window) - NOW())))::INTEGER
    );
  END IF;

  UPDATE partner_invitations
  SET token_hash = p_token_hash,
      expires_at = p_expires_at,
      status = 'PENDING',
      last_sent_at = NOW(),
      resend_count = CASE
        WHEN resend_window_started_at IS NULL
          OR resend_window_started_at <= NOW() - v_window
        THEN 1 ELSE resend_count + 1 END,
      resend_window_started_at = CASE
        WHEN resend_window_started_at IS NULL
          OR resend_window_started_at <= NOW() - v_window
        THEN NOW() ELSE resend_window_started_at END
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('outcome', 'ok');
END;
$$;

ALTER FUNCTION public.resend_partner_invitation(UUID, UUID, TEXT, TIMESTAMPTZ, INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resend_partner_invitation(UUID, UUID, TEXT, TIMESTAMPTZ, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_partner_invitation(UUID, UUID, TEXT, TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;

-- ============================================================
-- Manual validation (no automated SQL harness in this repo):
--
--   1. As any authenticated JWT via PostgREST, each must fail 42501:
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "role": "User" }
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "status": "ACTIVE" }
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "parent_user_id": null }
--   2. POST /rest/v1/rpc/accept_partner_invitation as authenticated
--      must fail (permission denied) — service role only.
--   3. With a profile set to status = 'DISABLED', SELECT on contacts
--      as that user must return zero rows.
-- ============================================================
