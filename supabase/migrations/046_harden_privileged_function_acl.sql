-- ============================================================
-- 046_harden_privileged_function_acl.sql
-- Restrict mutating SECURITY DEFINER helpers to trusted callers.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
-- These helpers update cross-account operational state and are called
-- only by database triggers or service-role backend code. They must not
-- be directly callable by browser roles.
-- ============================================================

REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;
