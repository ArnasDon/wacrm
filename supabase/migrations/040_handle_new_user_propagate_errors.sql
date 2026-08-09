-- ============================================================
-- 040_handle_new_user_propagate_errors.sql — stop swallowing errors
-- in the signup trigger.
--
-- The problem
-- -----------
-- `public.handle_new_user()` (introduced in 001_initial_schema.sql,
-- last replaced in 017_account_sharing.sql) wraps its body in
-- `EXCEPTION WHEN OTHERS THEN RAISE WARNING ...; RETURN NEW`. If the
-- INSERT into `accounts` or `profiles` fails for any reason — a bad
-- constraint, an RLS/grant regression, a full disk, anything — the
-- exception is caught, logged as a WARNING (which most log pipelines
-- don't even surface), and the trigger returns NEW as if nothing
-- happened. GoTrue then reports the signup as a SUCCESS. The result
-- is a fully-authenticated `auth.users` row with no matching
-- `accounts`/`profiles` row: an orphaned user who can log in but
-- whose every subsequent query (all of which join through
-- `profiles.account_id` for tenancy) breaks in confusing ways far
-- from the actual cause.
--
-- Why the catch-all existed (and why it's not a reason to keep it)
-- ------------------------------------------------------------------
-- The 001-era comment says: "EXCEPTION block ensures signup still
-- succeeds even if profile insert fails — profile can be created
-- later if needed." That rationale doesn't hold up under inspection:
--   - `profiles.user_id` and `accounts.owner_user_id` are both
--     UNIQUE, and this trigger only ever fires once per row (a
--     single `AFTER INSERT ... FOR EACH ROW` trigger on `auth.users`,
--     which itself only inserts a given id once). There is no
--     "insert already exists, this is an expected duplicate" path.
--   - No code anywhere in this repo re-runs `handle_new_user`'s
--     logic for an existing user to "create the profile later" —
--     `redeem_invitation` (019_invitation_rpcs.sql) only ever
--     UPDATEs `profiles.account_id`/`account_role` on a row it
--     expects to already exist. There is no legitimate path where a
--     duplicate-key or missing-profile condition is expected and
--     recoverable; the original comment describes a safety net that
--     nothing on the other side ever used.
-- So the catch-all wasn't handling a known, expected failure mode —
-- it was blanket-suppressing every possible failure mode, expected or
-- not. That's the bug this migration fixes.
--
-- The fix
-- -------
-- Drop the EXCEPTION block entirely. With no handler, a failing
-- INSERT propagates as a normal Postgres error, which:
--   - rolls back the whole transaction, including the `auth.users`
--     insert GoTrue just made (Postgres triggers run inside the same
--     transaction as the statement that fired them) — no orphaned
--     auth user is left behind;
--   - surfaces to GoTrue as a failed signup (5xx to the client)
--     instead of a silent 200, so the failure is visible where it
--     happens instead of discovered later as "user can't see their
--     own data".
-- Better to fail loudly at signup time than to carry an inconsistent
-- row indefinitely.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Trigger definition is unchanged (still AFTER INSERT on auth.users,
-- still FOR EACH ROW) — only the function body changed, so no need
-- to drop/recreate the trigger itself.
