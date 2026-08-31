-- ============================================================
-- 040_provisioning_trigger.sql — Support provision metadata in handle_new_user
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
  v_prov_account_id TEXT;
  v_prov_role TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_prov_account_id := NEW.raw_user_meta_data->>'provision_account_id';
  v_prov_role := NEW.raw_user_meta_data->>'provision_role';

  -- If user was provisioned into an existing account, attach directly without creating personal account
  IF v_prov_account_id IS NOT NULL AND v_prov_account_id != '' THEN
    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (
      NEW.id,
      v_full_name,
      NEW.email,
      v_prov_account_id::uuid,
      COALESCE(v_prov_role::account_role_enum, 'agent')
    );
    RETURN NEW;
  END IF;

  -- Default signup path: create new account where user is owner
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
