-- PostgreSQL gives PUBLIC EXECUTE on new functions by default. Worker helpers
-- may bypass RLS, so authenticated users receive only the reviewed entrypoints.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, omni_app, omni_auth;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO omni_worker;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum) TO omni_app;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.account_role_enum) TO omni_app;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO omni_app;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid) TO omni_app;
GRANT EXECUTE ON FUNCTION public.peek_invitation(text) TO omni_app;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO omni_app;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(uuid[], text, integer, integer) TO omni_app;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO omni_app;
ALTER DEFAULT PRIVILEGES FOR ROLE omni_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
