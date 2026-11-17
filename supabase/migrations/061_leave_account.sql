CREATE OR REPLACE FUNCTION public.detach_member_to_personal_account(
  p_user_id UUID,
  p_account_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_name TEXT;
  v_email TEXT;
  v_new_account_id UUID;
BEGIN
  SELECT id, full_name, email
  INTO v_profile_id, v_name, v_email
  FROM profiles
  WHERE user_id = p_user_id
    AND account_id = p_account_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this account'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_name, ''), v_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  UPDATE conversations
  SET assigned_agent_id = NULL
  WHERE account_id = p_account_id
    AND assigned_agent_id = p_user_id;

  UPDATE deals
  SET assigned_to = NULL
  WHERE account_id = p_account_id
    AND assigned_to = v_profile_id;

  UPDATE ai_configs
  SET handoff_agent_id = NULL
  WHERE account_id = p_account_id
    AND handoff_agent_id = p_user_id;

  DELETE FROM notifications
  WHERE account_id = p_account_id
    AND user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.detach_member_to_personal_account(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.detach_member_to_personal_account(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id
  FOR UPDATE;

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
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  RETURN detach_member_to_personal_account(p_user_id, v_target_account_id);
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_account()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_account_id, v_role
  FROM profiles
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'The account owner cannot leave; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  RETURN detach_member_to_personal_account(auth.uid(), v_account_id);
END;
$$;

ALTER FUNCTION public.leave_account() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.leave_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_account() TO authenticated;
