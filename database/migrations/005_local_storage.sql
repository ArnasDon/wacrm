CREATE TABLE public.stored_objects (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (bucket IN ('avatars','chat-media','flow-media')),
  filename text NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 16777216),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stored_objects_account ON public.stored_objects(account_id);
ALTER TABLE public.stored_objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON public.stored_objects TO omni_app;
GRANT ALL ON public.stored_objects TO omni_worker;
CREATE POLICY stored_objects_read ON public.stored_objects FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY stored_objects_insert ON public.stored_objects FOR INSERT
  WITH CHECK (user_id=app.current_user_id() AND public.is_account_member(account_id)
    AND ((bucket='avatars') OR (bucket='chat-media' AND public.is_account_member(account_id,'agent')) OR (bucket='flow-media' AND public.is_account_member(account_id,'admin'))));
CREATE POLICY stored_objects_delete ON public.stored_objects FOR DELETE
  USING (public.is_account_member(account_id)
    AND ((bucket='avatars' AND user_id=app.current_user_id()) OR (bucket='chat-media' AND public.is_account_member(account_id,'agent')) OR (bucket='flow-media' AND public.is_account_member(account_id,'admin'))));
