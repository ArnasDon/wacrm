-- ============================================================
-- 110_revoke_trigger_fn_execute.sql — stop exposing pure trigger
-- functions as callable RPCs
--
-- `broadcast_recipient_aggregate_trigger`, `handle_new_user` and
-- `notify_conversation_assigned` are `SECURITY DEFINER` functions that
-- RETURN trigger — they only ever run from a trigger, never as an API
-- call. They still carry the default PUBLIC/anon/authenticated EXECUTE
-- grant, so Supabase's linter flags them (0028/0029) as
-- "anon can execute a SECURITY DEFINER function via /rest/v1/rpc/...".
-- Real exploitability is low (a trigger function invoked bare has no
-- NEW/OLD and errors), but there is no reason to expose them.
--
-- A trigger fires as part of its triggering statement regardless of
-- whether the invoking role holds EXECUTE on the function, so revoking
-- these grants does NOT affect signup, the broadcast counters, or the
-- assignment notification — it only removes the RPC surface.
--
-- The privileged broadcast / webhook / ai-slot helpers named in the
-- SANDÍA diagnostic (K.3) were already locked to service_role by
-- migration `restore_privileged_function_execute_acls` (2026-08-27) —
-- verified, nothing to do for those here.
--
-- Idempotent (REVOKE of an absent grant is a harmless no-op).
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.broadcast_recipient_aggregate_trigger()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_conversation_assigned()
  FROM PUBLIC, anon, authenticated;
