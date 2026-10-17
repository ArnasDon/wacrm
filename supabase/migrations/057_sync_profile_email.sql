-- ============================================================
-- 057_sync_profile_email.sql — AUTH-N2 fix: keep profiles.email in
--                                sync with auth.users.email
--
-- The problem
--
--   `handle_new_user` (001, redefined by 017) copies
--   `auth.users.email` into `profiles.email` exactly once, at signup
--   (`AFTER INSERT ON auth.users`). No trigger, RPC, or application
--   code has ever updated `profiles.email` again after that — an
--   exhaustive search of every migration and of `src/` found zero
--   writes to this column outside that one INSERT. When a user later
--   changes their email via Supabase Auth (`updateUser({ email })`,
--   used by `src/components/settings/profile-form.tsx`), only
--   `auth.users.email` changes; `profiles.email` is left holding the
--   old address indefinitely.
--
--   Most consumers of `profiles.email` are purely cosmetic (avatar
--   initials, sidebar/header greeting, the members list) — stale
--   there is a display nit. One consumer is NOT cosmetic:
--   `password-form.tsx` used `profiles.email` as the credential for
--   `signInWithPassword` when re-authenticating a user who wants to
--   change their password, which would fail with a misleading
--   "current password incorrect" for a user who had changed their
--   email — fixed separately in this same change by reading the real
--   email from `supabase.auth.getUser()` instead.
--
-- The fix
--
--   A trigger mirroring `handle_new_user`'s own pattern exactly
--   (SECURITY DEFINER, `SET search_path = public`, owned by
--   `postgres`, and the same "never let a sync failure block the
--   real auth.users write" EXCEPTION-swallowing shape) — but firing
--   `AFTER UPDATE OF email ON auth.users` instead of `AFTER INSERT`.
--   `IS DISTINCT FROM` in the trigger's WHEN clause (not just inside
--   the function body) means the function isn't even invoked unless
--   the email actually changed (handles NULL correctly, and is
--   cheaper than firing on every unrelated auth.users update).
--
--   No new table, no new RPC, no token of any kind — this only keeps
--   an existing mirror column in sync with the column it was always
--   meant to mirror.
--
-- Why no REVOKE/GRANT (unlike the client-callable RPCs elsewhere in
-- this schema, e.g. set_member_role, insert_inbound_customer_message):
--
--   This function is declared `RETURNS TRIGGER`, the same as
--   `handle_new_user`. Postgres does not allow a function declared
--   RETURNS TRIGGER to be invoked directly via SQL/RPC at all — it can
--   only run as the effect of the trigger mechanism firing on the
--   table it's attached to (calling it directly errors with something
--   like "trigger functions can only be called as triggers"). That is
--   a structural property of RETURNS TRIGGER, not a GRANT policy this
--   migration has to set up — `handle_new_user` has never had a
--   REVOKE/GRANT pair either, for the exact same reason. This is a
--   different class of function from the client-callable RPCs
--   (RETURNS void / RETURNS TABLE / etc.) where a missing REVOKE/GRANT
--   was a real bug (IC-M1) — that lesson doesn't apply here, and
--   nothing analogous to add.
--
-- Backfill
--
--   Included in this same migration: a one-time
--   `UPDATE profiles ... FROM auth.users ... WHERE ... IS DISTINCT
--   FROM ...` for rows that already drifted before this trigger
--   existed. Verified safe before including it:
--     - RLS does not apply here: this migration runs as the database
--       owner (via the Supabase CLI's migration runner), and RLS is
--       enforced against `authenticated`/`anon`/other non-superuser
--       roles, not against the table owner/superuser — `profiles`
--       has no `FORCE ROW LEVEL SECURITY` set, so this is not even a
--       borderline case.
--     - No other write path to `profiles.email` exists anywhere in
--       this schema (confirmed exhaustively — see AUTH-N2 audit
--       report), so any row where `profiles.email <> auth.users.email`
--       today is, by construction, exactly the staleness bug being
--       fixed here — never an intentional divergence some other part
--       of the system depends on.
--     - `auth.users.email` is the only account identity Supabase Auth
--       itself ever authenticates against (login, password reset);
--       `profiles.email` was always meant to be a read-only mirror of
--       it, never an independent source (see `handle_new_user`, which
--       only ever copies FROM auth.users TO profiles, never the
--       reverse).
--     - The UPDATE touches ONLY the `email` column, matched by
--       `user_id = auth.users.id`, and only when the value actually
--       differs (`IS DISTINCT FROM`) — idempotent, safe to re-run,
--       and does not touch account_id / account_role / full_name / or
--       any other column.
--     - `AND u.email IS NOT NULL` guards against ever writing NULL
--       into `profiles.email` (NOT NULL since 001) — defensive only;
--       this project has no non-email auth method, so a NULL
--       `auth.users.email` on an existing row is not expected, but a
--       bare UPDATE (unlike the trigger's own EXCEPTION handler) would
--       abort this entire migration on a NOT NULL violation if one
--       ever existed.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- One-time backfill for rows that drifted before this trigger existed.
-- ------------------------------------------------------------
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.user_id = u.id
  AND u.email IS NOT NULL
  AND p.email IS DISTINCT FROM u.email;

-- ------------------------------------------------------------
-- Ongoing sync trigger.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE user_id = NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a sync failure block the real auth.users email change —
  -- same philosophy as handle_new_user's own EXCEPTION block.
  RAISE WARNING 'Failed to sync profile email for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_profile_email() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email();

-- ============================================================
-- Manual validation (run against a live instance — no automated SQL
-- test harness exists in this repo; same caveat as migrations
-- 034/054/055/056):
--
--   1. Confirm the backfill: for any pre-existing user whose
--      auth.users.email differs from their profiles.email, after this
--      migration `SELECT p.email, u.email FROM profiles p JOIN
--      auth.users u ON u.id = p.user_id WHERE p.user_id = '<id>'`
--      must show both columns equal.
--   2. Trigger a real email change via Supabase Auth
--      (`supabase.auth.updateUser({ email: '<new>' })`, following the
--      confirmation flow) for a test user, then confirm
--      `profiles.email` reflects the new address once the change
--      completes on the `auth.users` side.
--   3. Confirm profiles.account_id / account_role / full_name are
--      unchanged by both the backfill and the trigger.
-- ============================================================
