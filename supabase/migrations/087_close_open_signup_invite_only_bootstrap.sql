-- ============================================================
-- 087_close_open_signup_invite_only_bootstrap.sql
--
-- Closes the "any signup mints a free owner account" hole.
--
-- Before: `handle_new_user`'s ELSE branch created a full owner account +
-- profile for EVERY new `auth.users` row. `/signup?invite=<token>` never
-- validates the token at signup time, so `/signup?invite=anything`
-- produced a working, isolated account. RLS keeps the data separate, but
-- it's free infrastructure + noise in the platform-admin panel.
--
-- After:
--   * `handle_new_user` bootstraps an account ONLY for a matched
--     platform "new company" invitation (`platform_company_invitations`).
--     Every other signup creates nothing.
--   * `redeem_invitation()` now CREATES the caller's profile — straight
--     into the inviting account, name/email read from `auth.users` — when
--     they have none yet. That is the normal state for a brand-new
--     team-invite signup after this change. Callers who already have an
--     account keep the unchanged sole-owner + zero-data-check path (whose
--     "does the old account hold data" whitelist is also extended here to
--     the tables added since migration 019: products, quotes, ai_configs,
--     api_keys, webhook_endpoints, quick_replies, *_config).
--   * A signup with no valid invite of any kind = an inert login with no
--     profile row. `is_account_member()` reads `profiles`, so every RLS
--     policy denies it and every API route 403s.
--
-- The password step is unaffected — it is set by `supabase.auth.signUp()`
-- in the invite signup form, not by this trigger.
--
-- Applied to production 2026-08-27 via the Supabase MCP (with an
-- account-less redeem smoke test, rolled back) and recorded here to keep
-- the repo authoritative.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_invitation public.platform_company_invitations%ROWTYPE;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  SELECT * INTO v_invitation
  FROM public.platform_company_invitations
  WHERE lower(invited_email) = lower(COALESCE(NEW.email, ''))
    AND accepted_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Only a platform "new company" invite bootstraps an account here.
  IF v_invitation.id IS NOT NULL THEN
    INSERT INTO public.accounts (name, owner_user_id)
    VALUES (v_invitation.company_name, NEW.id)
    RETURNING id INTO v_account_id;

    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

    UPDATE public.platform_company_invitations
    SET accepted_at = now(), account_id = v_account_id
    WHERE id = v_invitation.id;
  END IF;

  -- No platform invite -> create nothing. A team-invite signup gets its
  -- profile from redeem_invitation() on accept; a signup with no valid
  -- invite is an inert, profile-less login.
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_profile BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed' USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Brand-new team-invite signup: no profile yet (handle_new_user only
  -- bootstraps for platform "new company" invites now). Create the
  -- profile straight into the inviting account and finish.
  SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_caller_id) INTO v_has_profile;
  IF NOT v_has_profile THEN
    INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
    SELECT u.id,
           COALESCE(u.raw_user_meta_data->>'full_name', ''),
           COALESCE(u.email, ''),
           v_inv.account_id,
           v_inv.role
    FROM auth.users u
    WHERE u.id = v_caller_id;

    UPDATE account_invitations
    SET accepted_at = NOW(), accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id;

    RETURN v_inv.account_id;
  END IF;

  -- Caller already has a profile + account. Unchanged path.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account' USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM products WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quotes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM google_calendar_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM instagram_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM facebook_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;
ALTER FUNCTION public.redeem_invitation(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;
