DROP POLICY IF EXISTS profiles_insert ON public.profiles;

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
    RAISE EXCEPTION
      'profiles are created by the signup trigger; they cannot be inserted directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
  THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
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

DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND (
          ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          OR auth.uid()::text = (storage.foldername(name))[1]
        )
    )
  );

DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND (
          ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          OR auth.uid()::text = (storage.foldername(name))[1]
        )
    )
  )
  WITH CHECK (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND (
          ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          OR auth.uid()::text = (storage.foldername(name))[1]
        )
    )
  );

DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND (
          ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          OR auth.uid()::text = (storage.foldername(name))[1]
        )
    )
  );

DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_conversation_assignee_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND EXISTS (
       SELECT 1 FROM profiles
       WHERE user_id = OLD.assigned_agent_id
         AND account_id = OLD.account_id
     )
  THEN
    NEW.assigned_agent_id := OLD.assigned_agent_id;
  ELSE
    NEW.assigned_agent_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_conversation_assignee_membership() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_conversation_assignee_membership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_conversation_assignee_membership ON public.conversations;
CREATE TRIGGER enforce_conversation_assignee_membership
  BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_assignee_membership();

CREATE OR REPLACE FUNCTION public.notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_conversation_assigned() OWNER TO postgres;

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
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
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

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
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

  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  UPDATE conversations
  SET assigned_agent_id = NULL
  WHERE account_id = v_target_account_id
    AND assigned_agent_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

UPDATE public.conversations c
SET assigned_agent_id = NULL
WHERE c.assigned_agent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = c.assigned_agent_id
      AND p.account_id = c.account_id
  );
