-- Authentication owns identity email/name/image. Keep the CRM projection
-- synchronized after verified email changes and profile updates.
CREATE FUNCTION public.sync_identity_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ BEGIN
  UPDATE public.profiles SET full_name=NEW.name,email=NEW.email,avatar_url=NEW.image
    WHERE user_id=NEW.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_identity_profile() FROM PUBLIC,omni_app,omni_auth;
CREATE TRIGGER sync_identity_profile AFTER UPDATE OF name,email,image ON identity.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_identity_profile();
