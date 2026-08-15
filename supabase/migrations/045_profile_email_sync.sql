-- Keep the public profile email aligned with the confirmed Supabase Auth email.
-- Platform-admin access remains attached to profiles.user_id and is therefore
-- unaffected by an email-address change.

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email
    WHERE user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_profile_email_from_auth() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM anon;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email_from_auth();
