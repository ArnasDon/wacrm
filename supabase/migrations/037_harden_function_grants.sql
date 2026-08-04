-- ============================================================
-- 037_harden_function_grants.sql — lock down EXECUTE on
-- public functions (security hardening, advisory-driven)
--
-- Why this exists
--
--   Supabase ships default privileges that grant EXECUTE on every
--   newly-created public function to the `anon`, `authenticated`
--   and `service_role` roles. Earlier migrations revoked only
--   PUBLIC (`REVOKE ALL ... FROM PUBLIC`) where they locked a
--   function down — the role-level grants from the default
--   privileges remained. Result: several SECURITY DEFINER /
--   mutating functions stayed callable by unauthenticated or
--   low-privilege callers via /rest/v1/rpc/*, including:
--
--     - merge_duplicate_contacts / merge_duplicate_conversations
--       (destructive data merges)        — callable by anon
--     - _bcast_bump / recompute_broadcast_counts / record_webhook_failure
--       (broadcast counter + endpoint state writes) — anon
--     - claim_ai_reply_slot (counter mutation)       — anon
--     - handle_new_user / notify_conversation_assigned /
--       broadcast_recipient_aggregate_trigger (trigger fns) — anon
--
--   This migration makes the intent explicit on every public
--   function: revoke the default role grants and re-grant EXECUTE
--   only to the role(s) the matching code path actually runs as.
--   This is the same REVOKE/GRANT pattern migrations 007, 012,
--   018, 019, 025, 030 and 031 already use — 037 just applies it
--   consistently to every function the advisors flagged.
--
--   It also:
--     - pins SET search_path on the four functions the security
--       advisor flagged as "role mutable search_path"
--       (update_updated_at_column, _bcast_cols_for_status,
--       update_ai_configs_updated_at,
--       update_ai_knowledge_documents_updated_at)
--     - moves the `vector` extension out of the `public` schema
--       into `extensions` (the project's search_path already
--       includes `extensions`, and uuid-ossp/pgcrypto already
--       live there).
--
-- Idempotent — safe to run multiple times (REVOKE/GRANT are
-- no-ops when the privilege is already in the target state).
-- ============================================================

-- ============================================================
-- 1. PIN SEARCH_PATH (ALTER FUNCTION, keeps ACLs untouched)
-- ============================================================
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public._bcast_cols_for_status(text) SET search_path = public;
ALTER FUNCTION public.update_ai_configs_updated_at() SET search_path = public;
ALTER FUNCTION public.update_ai_knowledge_documents_updated_at() SET search_path = public;

-- ============================================================
-- 2. RLS BACKBONE — is_account_member
--    Policies evaluate as the querying role, so authenticated
--    must keep EXECUTE. anon never passes a policy, so it loses
--    the grant. service_role (engine) keeps it.
-- ============================================================
REVOKE ALL ON FUNCTION public.is_account_member(uuid, account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- 3. INVITATION RPCs
--    peek_invitation is intentionally anon+authenticated (the
--    /join/<token> page renders before sign-in). redeem is
--    authenticated-only and self-checks auth.uid().
-- ============================================================
REVOKE ALL ON FUNCTION public.peek_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;

-- ============================================================
-- 4. MEMBER-MANAGEMENT RPCs (018) — authenticated only
--    Each self-checks auth.uid()/role before acting.
-- ============================================================
REVOKE ALL ON FUNCTION public.set_member_role(uuid, account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, account_role_enum) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_account_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid) TO authenticated;

-- ============================================================
-- 5. CONTACT / CONVERSATION TAG FILTER (025) — authenticated
--    SECURITY INVOKER; RLS already scopes it. anon gains nothing.
-- ============================================================
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(uuid[], text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(uuid[], text, integer, integer) TO authenticated;

-- ============================================================
-- 6. AI KNOWLEDGE RETRIEVAL (030/032) — authenticated + service_role
--    INVOKER since 032; RLS scopes by account. anon loses access.
-- ============================================================
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;

-- ============================================================
-- 7. PRESENCE HEARTBEAT (024) — authenticated (client) only
-- ============================================================
REVOKE ALL ON FUNCTION public.touch_presence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO authenticated;

-- ============================================================
-- 8. ENGINE-ONLY MUTATORS — service_role only
--    The engine/webhook runs as service_role; no client ever
--    calls these. claim_ai_reply_slot already had the GRANT in
--    031; the role-level revokes close the anon/authenticated
--    holes left by the default privileges.
-- ============================================================
REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public._bcast_cols_for_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_recipient_aggregate_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid) TO service_role;

-- ============================================================
-- 9. DESTRUCTIVE MAINTENANCE (022 / 036) — service_role only
--    These merge + delete rows across tables. anon/authenticated
--    must never reach them; only an operator via service_role.
-- ============================================================
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_conversations() TO service_role;

-- ============================================================
-- 10. TRIGGER FUNCTIONS — no external EXECUTE at all
--     Postgres invokes trigger functions without an EXECUTE
--     check, so removing every role grant is safe and closes the
--     RPC surface entirely.
-- ============================================================
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_conversation_assigned() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_ai_configs_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_ai_knowledge_documents_updated_at() FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 11. VECTOR EXTENSION — out of `public`, into `extensions`
--     The project's search_path is "$user", public, extensions,
--     so unqualified `vector` type/operator references still
--     resolve. uuid-ossp and pgcrypto already live there.
-- ============================================================
ALTER EXTENSION vector SET SCHEMA extensions;
