-- ============================================================
-- 085_restore_privileged_function_execute_acls.sql
--
-- A 2026-08 audit of the live database found that the
-- `REVOKE ALL ... FROM PUBLIC` statements in migrations 018, 019,
-- 022 and 036 never actually applied to production (migration-history
-- drift — the tracked ledger only starts 2026-08-14). Verified via
-- `pg_proc.proacl`.
--
-- Impact that was live before this migration:
--
--   * `merge_duplicate_contacts()` / `merge_duplicate_conversations()`
--     are SECURITY DEFINER, take no arguments, perform a GLOBAL
--     cross-account merge + DELETE, and carry NO `auth.uid()` / role
--     check. They were EXECUTE-able by the `anon` role, so an
--     unauthenticated `POST /rest/v1/rpc/merge_duplicate_contacts`
--     triggered a destructive sweep across every tenant. No
--     application code calls these — they are manual maintenance
--     helpers only.
--
--   * `set_member_role` / `remove_account_member` /
--     `transfer_account_ownership` / `redeem_invitation` were also
--     `anon`-executable. Inert (each RAISEs 42501 when
--     `auth.uid() IS NULL`, plus role checks) but the intended `anon`
--     revoke is restored for defense in depth. They remain callable by
--     `authenticated` — the API routes invoke them as that role.
--
--   * `touch_presence` had only the PostgreSQL default PUBLIC grant.
--     Inert (self-authorises) but tightened to `authenticated`, the
--     presence-heartbeat's real caller.
--
-- `peek_invitation` is deliberately left `anon`-executable — the
-- public /join/<token> page calls it before sign-in.
--
-- Idempotent. This migration was applied to production on 2026-08-27
-- via the Supabase MCP and is recorded here to keep the repo
-- authoritative.
-- ============================================================

-- ---- HIGH: unauthenticated destructive cross-tenant maintenance ----
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;

REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_conversations() TO service_role;

-- ---- Defense in depth: drop the stray `anon` grant, keep `authenticated` ----
REVOKE ALL ON FUNCTION public.set_member_role(uuid, account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, account_role_enum) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_account_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.transfer_account_ownership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;

REVOKE ALL ON FUNCTION public.touch_presence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO authenticated;
