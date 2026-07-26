-- ============================================================
-- 034_fix_profiles_update_rls.sql — lock down privilege columns
--                                    on profiles (GHSA-fg5p-2qc3-jmxr, C1)
--
-- NOTE: renamed from 031 → 034 to resolve a duplicate migration version.
-- The 031 slot was already taken by 031_ai_reply_slot_grant.sql (#345),
-- so shipping this as 031 too made a clean `supabase db` apply fail with
-- a duplicate schema_migrations key (SQLSTATE 23505). This migration is
-- idempotent (DROP POLICY IF EXISTS / CREATE OR REPLACE) and independent
-- of the AI tables, so re-sequencing it after 033 is safe.
--
-- The problem
--
--   The `profiles_update` RLS policy from migration 017 gates on
--   `auth.uid() = user_id` only — it lets a user edit their *own*
--   row, which is correct for self-service fields (full_name,
--   avatar). But `account_role` and `account_id` also live on
--   `profiles`, and they are the source of truth for
--   `is_account_member()`. RLS constrains *which rows* you may
--   update, not *which columns*, and no column-level GRANT or
--   trigger guards them. So the normal `authenticated` browser
--   client can self-serve a privilege escalation / tenant move:
--
--     -- viewer self-promotes to owner of the shared account
--     UPDATE profiles SET account_role = 'owner' WHERE user_id = auth.uid();
--     -- attacker relocates into a victim tenant
--     UPDATE profiles SET account_id = '<victim>' WHERE user_id = auth.uid();
--
--   Both pass the WITH CHECK because `user_id` is unchanged.
--
-- The fix
--
--   A BEFORE UPDATE trigger that rejects any change to
--   `account_role` / `account_id` when the caller is the
--   `authenticated` role (the browser). The legitimate writers are
--   unaffected:
--     - handle_new_user + the 018/019 member/invitation RPCs are
--       SECURITY DEFINER owned by `postgres`, so `current_user` is
--       `postgres`, not `authenticated`.
--     - the server backend runs as `service_role`.
--   Self-service edits that leave both columns untouched (the
--   IS DISTINCT FROM checks are false) also pass through freely.
--
--   Membership stays owned by the supervised RPCs (018/019), which
--   is exactly the model migration 018's header describes.
--
-- NOTE FOR MAINTAINER
--
--   `current_user` is the reliable discriminator here because every
--   sanctioned writer runs as postgres (DEFINER) or service_role,
--   and PostgREST's browser clients run as `authenticated`. If you
--   ever add a NON-definer RPC or a new role that must write these
--   columns, extend the guard's role check accordingly. Validate in
--   your own environment before relying on this (see the checks at
--   the bottom); this migration was not run against a live database.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id)
     AND current_user = 'authenticated'
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
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ============================================================
-- Manual validation (run against a live instance — no automated
-- SQL test harness exists in this repo):
--
--   1. As a viewer/member JWT via PostgREST, both of these must
--      return 42501 (insufficient_privilege):
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "account_role": "owner" }
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "account_id": "<other>" }
--   2. A self-service edit that leaves both columns alone must
--      still succeed:
--        PATCH /rest/v1/profiles?user_id=eq.<self> { "full_name": "New Name" }
--   3. The member/invitation RPCs (set_member_role,
--      transfer_account_ownership, redeem_invitation) must still
--      succeed — they run SECURITY DEFINER as postgres.
-- ============================================================
