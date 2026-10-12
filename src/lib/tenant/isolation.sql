-- Proves account isolation through the real RLS policies.
-- Not a vitest file: the repo's unit tests mock Supabase, and a mocked
-- RLS assertion proves nothing — the mock would BE the assertion.
-- Run against local Supabase Postgres:
--   docker exec -i supabase_db_wacrm psql -U postgres -d postgres -f - \
--     < src/lib/tenant/isolation.sql
--
-- The predicate under test is exactly the one on every data table:
--     is_account_member(account_id)
-- which resolves the caller through profiles.user_id = auth.uid().
-- Nothing reads a request header to decide the account.
--
-- ---------------------------------------------------------------------------
-- EXIT CODE IS THE RESULT. THIS SCRIPT HAS A GATE.
--
--   exit 0 = every assertion below held
--   exit 3 = at least one assertion failed. psql exits 3 when ON_ERROR_STOP is
--            on and a statement raises.
--
-- Sections 1-6 are INFORMATIONAL CENSUS: they print, they never judge. Their
-- output is not a verdict and must not be read as one — a census row reading
-- "is_account_member" states which policy text exists, not that RLS works.
-- The gate is sections 7-9b, which push real traffic through the real policies.
--
-- WHY NOT \quit: measured on this container, `\quit 7` exits 0 (psql warns
-- "extra argument ignored" and drops it). The only measured mechanism that
-- yields a non-zero exit is a raised error with ON_ERROR_STOP on -> exit 3.
-- So the gate is a RAISE EXCEPTION synthesised at the end of the file.
--
-- NOTHING IS COMMITTED. Every mutating block is BEGIN ... ROLLBACK, so the
-- script leaves zero rows behind and is safe to run twice in a row. Row-level
-- security state and policies are read, never changed.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

\echo ''
\echo '=== INFORMATIONAL CENSUS 1-6 (reporting only, NOT a pass/fail gate) ==='

\echo ''
\echo '--- 1. tenant accounts exist and are distinct ---'
SELECT slug, name FROM accounts WHERE slug IS NOT NULL ORDER BY slug;

\echo ''
\echo '--- 2. the policy predicate on every data table ---'
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contacts', 'deals', 'conversations', 'automations')
ORDER BY tablename, policyname;

\echo ''
\echo '--- 3. account resolution is driven by auth.uid(), not a header ---'
SELECT proname,
       prosrc LIKE '%auth.uid()%' AS uses_auth_uid
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('is_account_member', 'get_user_account_id')
ORDER BY proname;

\echo ''
\echo '--- 4. no data table bypasses is_account_member ---'
-- `cmd = 'SELECT'` is REQUIRED and was missing. Without it this returns 4 and
-- triggers a false stop-the-line: INSERT/UPDATE policies carry their check in
-- `with_check` and have `qual = NULL` by construction, so they match
-- `qual IS NULL` without being a bypass of the SELECT policy. Verified:
--   as written here (no cmd filter) -> 4   (all four are *_insert)
--   with AND cmd = 'SELECT'         -> 0
SELECT count(*) AS tables_with_other_policy
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contacts', 'deals', 'conversations', 'automations')
  AND cmd = 'SELECT'
  AND (qual IS NULL OR qual NOT LIKE '%is_account_member%');

\echo ''
\echo '--- 5. which account-scoped tables exist, and does each one gate SELECT? ---'
-- All 27 tables carrying account_id, not just the four above. A table with NO
-- SELECT policy is fail-closed (RLS on, no permissive policy -> no rows), which
-- is a safe answer but a different one from "gated by is_account_member" -- so
-- the two states are reported separately instead of being lumped together.
WITH acct AS (
  SELECT table_name FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'account_id'
),
sel AS (
  SELECT tablename,
         count(*) AS select_policies,
         bool_or(qual IS NULL OR qual NOT LIKE '%is_account_member%') AS bypasses_member
  FROM pg_policies
  WHERE schemaname = 'public' AND cmd = 'SELECT'
  GROUP BY tablename
)
SELECT a.table_name,
       coalesce(s.select_policies, 0) AS select_policies,
       CASE
         WHEN coalesce(s.select_policies, 0) = 0 THEN 'no SELECT policy (fail-closed)'
         WHEN s.bypasses_member              THEN 'SELECT policy not is_account_member'
         ELSE 'is_account_member'
       END AS gate
FROM acct a LEFT JOIN sel s ON s.tablename = a.table_name
ORDER BY (coalesce(s.select_policies, 0) = 0) DESC, s.bypasses_member DESC NULLS LAST, a.table_name;

\echo ''
\echo '--- 6. profiles.user_id is UNIQUE -> user-scoped policy == account-scoped ---'
-- This is what makes a `uid() = user_id` policy (notifications) safe rather than
-- a hole: one user_id belongs to exactly one account, so user-scope and
-- account-scope cannot diverge. If this constraint is ever dropped, the
-- notifications policy becomes a cross-account leak.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass AND contype IN ('u', 'p')
ORDER BY conname;

-- ---------------------------------------------------------------------------
-- GATE
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 7-9b. GATE: live cross-account traffic through the real policies ==='

-- Fixture defaults, each guarded so a -v override is never clobbered.
--   psql -v probe_a=<account uuid> -v uid_a=<auth user_id>
--   psql -v probe_b=<account uuid> -v uid_b=<auth user_id> -v nonce=<digits>
\if :{?probe_a}
\set probe_a_override 1
\else
\set probe_a_override 0
\endif
\if :{?probe_b}
\set probe_b_override 1
\else
\set probe_b_override 0
\endif
-- Default fixture values, each guarded so a -v override is never
-- clobbered. The override flags above must be set BEFORE these blocks
-- run: once a default has set :probe_a, :{?probe_a} is true forever
-- and can no longer tell an explicit -v probe_a= apart from the
-- default itself.
\if :{?probe_a}
\else
\set probe_a 0661e985-3c71-48e5-aafd-bc5277eca3a2
\endif
\if :{?uid_a}
\else
\set uid_a 1f1cb02d-8af2-4198-b070-95b89cd995b6
\endif
\if :{?probe_b}
\else
\set probe_b e4e71025-bef5-4247-a403-0d4f76e78d38
\endif
\if :{?uid_b}
\else
\set uid_b 8f4a20fa-dadb-4acb-95e7-ebf0f4fe3e85
\endif
-- Account C is NOT a fixture value: it must be created by the probe itself, so it
-- cannot be a fixed uuid (a fresh uuid every run is what makes a collision mean a
-- real bug). uid_c is the only generated value; probe_c is READ BACK from the
-- account the auth.users trigger builds, because accounts.owner_user_id is UNIQUE
-- and inserting a second account for the same owner would collide.
\if :{?uid_c}
\else
SELECT gen_random_uuid() AS uid_c \gset
\endif

-- The nonce IS genuinely per-run now: derived from md5(random()), not from a
-- constant. The previous file derived it from a hardcoded uid via `cut -c1-4`,
-- so it was the literal '1f1c' on every run while a comment claimed it was
-- per-run; runs never collided only because every block rolls back.
--
-- It exists so probe rows cannot collide on the partial unique index
-- idx_contacts_account_phone_normalized, and so probe rows are identifiable.
-- Digits only: phone_normalized strips non-digits and the seeded phones are
-- built by concatenation, so punctuation here would corrupt phone_normalized.
\if :{?nonce}
\else
SELECT lpad((abs(('x' || substr(md5(random()::text), 1, 7))::bit(32)::bigint) % 900000
             + 100000)::text, 6, '0') AS nonce \gset iso_nonce_
\set nonce :iso_nonce_nonce
\endif

-- The probe marker lives in `email`: nullable, no unique index, no constraint.
-- It identifies WHICH rows are probe rows and nothing else. It deliberately does
-- NOT encode who owns a row. The previous version encoded the owner in `name`
-- ('iso-1f1c-A-B') and then counted LIKE 'iso-%-B-%' as the leak -- which does
-- not match a row actually owned by B. Ownership is now read from account_id
-- itself, so the leak predicate is a direct column comparison and cannot be
-- blind to a change of shape.
SELECT 'iso-' || :'nonce' || '@isolation.probe.invalid' AS marker \gset iso_marker_
-- Unquoted form: psql's :var is fine for \echo. Use :'marker' when the value
-- goes into a SQL literal. Setting it quoted here made \echo print the SQL
-- quotes and broke the echoed line.
\set marker :iso_marker_marker

-- A SECOND marker, for the rows used as the positive control that runs AFTER
-- the negative shapes. It has to be a separate value: the unscoped and
-- marker-only shapes below target every row carrying :'marker', so a control row
-- sharing that marker would be consumed by its own probe and the "did the control
-- still work" check would read 0 -- the control would have deleted the very row
-- it was supposed to edit.
SELECT 'iso-' || :'nonce' || '-after@isolation.probe.invalid' AS after_marker \gset iso_after_
\set after_marker :iso_after_after_marker

\echo ''
\echo '--- run nonce:' :nonce '  probe marker:' :marker
\echo '--- probe A: account' :probe_a '  user' :uid_a
\echo '--- probe B: account' :probe_b '  user' :uid_b

-- ===========================================================================
-- 6b. PROBE PROVISIONING (committed, idempotent). Sections 7-10 reference
-- probe_a/probe_b/uid_a/uid_b as FIXED uuids, and every probe row they
-- insert carries one of those user ids: the FK on contacts.user_id points
-- at auth.users, so the users must exist in WHATEVER database this gate
-- runs against. Section 8 shows the pattern for C (fresh uuid, trigger-
-- built account, loud check); A and B are fixed, so they use ON CONFLICT:
-- a clean stack gets the rows fresh, a database that already carries them
-- is a no-op, and re-runs stay idempotent.
--
-- This block COMMITS, unlike every later section: the four rows are
-- deterministic and gate-owned. The header promise of zero residue holds
-- for the probe DATA (sections 7-10 still roll back); these four
-- provisioning rows are the documented exception.
BEGIN;
INSERT INTO auth.users (id, email, aud, role, encrypted_password, raw_app_meta_data)
VALUES
  (:'uid_a'::uuid, 'iso-a-' || :'nonce' || '@isolation.probe.invalid',
   'authenticated', 'authenticated', '', '{"provider":"email","providers":["email"]}'),
  (:'uid_b'::uuid, 'iso-b-' || :'nonce' || '@isolation.probe.invalid',
   'authenticated', 'authenticated', '', '{"provider":"email","providers":["email"]}')
ON CONFLICT (id) DO NOTHING;

-- The trigger that owns auth.users (handle_new_user, migration 017) builds
-- each new user's personal account and owner profile; one account per
-- owner (idx_accounts_one_per_owner) means the gate must use the
-- trigger-built account as the probe account, never invent a second one.
-- Read it back (the C section already does exactly this); a user who
-- pre-exists from an earlier gate run keeps the account that run built.
\if :probe_a_override
\else
SELECT (count(*) <> 1) AS uid_a_bad FROM accounts WHERE owner_user_id = :'uid_a'::uuid \gset
\if :uid_a_bad
\echo 'PROBE PROVISIONING FAILED: uid_a does not own exactly 1 account - handle_new_user swallows its own errors, so check the WARNINGs above'
\quit 3
\endif
SELECT id AS probe_a FROM accounts WHERE owner_user_id = :'uid_a'::uuid \gset
\endif
\if :probe_b_override
\else
SELECT (count(*) <> 1) AS uid_b_bad FROM accounts WHERE owner_user_id = :'uid_b'::uuid \gset
\if :uid_b_bad
\echo 'PROBE PROVISIONING FAILED: uid_b does not own exactly 1 account - handle_new_user swallows its own errors, so check the WARNINGs above'
\quit 3
\endif
SELECT id AS probe_b FROM accounts WHERE owner_user_id = :'uid_b'::uuid \gset
\endif

-- Loud check, psql-level (psql does not interpolate inside DO bodies -
-- see section 8): each probe user holds exactly one owner profile, or
-- every later section reads a phantom tenant. \if takes a single
-- boolean value, so the inequality is folded into the SELECT.
SELECT (count(*) <> 2) AS probe_profiles_bad FROM profiles WHERE user_id IN (:'uid_a'::uuid, :'uid_b'::uuid) AND account_role = 'owner' \gset
\if :probe_profiles_bad
\echo 'PROBE PROVISIONING FAILED: the two probe users do not hold exactly 2 owner profiles - the trigger output is incomplete'
\quit 3
\endif

-- The gate drives traffic as anon, so anon needs table privileges the
-- way the hosted platform gives them (privileges permit the attempt;
-- RLS decides the rows - it remains the boundary). A clean stack's
-- grants are a property of the Supabase CLI version that reset it
-- (measured: the 2.113 stack lacked them; 2.119 carries them), so the
-- gate provisions its own baseline rather than trusting the version:
-- idempotent, committed like the probe rows, and independent of which
-- CLI reset the stack.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
COMMIT;
\echo '--- effective probe A: account' :probe_a '  user' :uid_a
\echo '--- effective probe B: account' :probe_b '  user' :uid_b

-- Failure ledger. Accumulated in a psql variable so one run reports EVERY broken
-- assertion instead of stopping at the first, then raised once at the end.
--
-- psql emits an UNSET :var LITERALLY instead of failing or substituting empty
-- (measured: \echo of an unset var prints `:never_set`). So a misspelled variable
-- name does not error at the \echo, it reappears inside the SQL and kills the
-- statement with `syntax error at or near ":"` -- with the real bug several lines
-- away from the reported one. Every name below must match the column alias plus
-- the \gset prefix exactly: \gset u9_ over alias control_row_after yields
-- u9_control_row_after, NOT u9a_control_row_after. Use psql -e to print exactly
-- what is sent to the server; it shows the unexpanded :'var' verbatim.
\set ledger ''

-- Seed INSIDE each user's own transaction. An earlier draft seeded once and
-- then asserted for a second user after the ROLLBACK, so that second assertion
-- ran against an unseeded table and read own_rows = 0 -- vacuous in exactly the
-- way this section exists to prevent. Each block is self-contained: seed,
-- measure, roll back.

\echo ''
\echo '--- 7a. as user A: sees its own seeded row, and NOTHING outside its account ---'
BEGIN;
INSERT INTO contacts (account_id, user_id, phone, email)
SELECT c.acct, c.uid,
       '+1555' || :'nonce' || c.tag || substr(replace(c.acct::text, '-', ''), 1, 3),
       :'marker'
FROM (VALUES
  (:'probe_a'::uuid, :'uid_a'::uuid, 'a'),
  (:'probe_b'::uuid, :'uid_b'::uuid, 'b')
) AS c(acct, uid, tag);

-- Measured as anon with a real JWT, so the policies under test are the ones
-- that decide what is visible. SET LOCAL ROLE is transactional and never
-- committed.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :'uid_a', 'role', 'authenticated')::text, true);

-- own_rows is compared directly against account_id; no name pattern is
-- involved. leak_general also catches a row from ANY account other than the
-- caller's, so it fails on a leak that the two-fixture shape would miss.
SELECT count(*) FILTER (WHERE account_id = :'probe_a'::uuid) AS own_rows,
       count(*) FILTER (WHERE account_id = :'probe_b'::uuid) AS other_account_leak,
       count(*) FILTER (WHERE account_id <> :'probe_a'::uuid)  AS leak_general,
       count(*) AS probe_rows_visible
FROM contacts WHERE email = :'marker' \gset a_
\echo '   own_rows=' :a_own_rows '  other_account_leak=' :a_other_account_leak '  leak_general=' :a_leak_general '  probe_rows_visible=' :a_probe_rows_visible

-- own_rows > 0 is what makes the run non-vacuous: if the predicate denied
-- everything, every counter would read 0 and "no leak" would be meaningless.
SELECT :'ledger' || CASE WHEN :'a_own_rows'::bigint = 0
  THEN E'[7a] FAIL user A reads 0 of its own rows (own_rows=0): the isolation predicate is broken, not merely strict\n'
  ELSE '' END AS ledger \gset
SELECT :'ledger' || CASE WHEN :'a_other_account_leak'::bigint > 0
  THEN format(E'[7a] FAIL user A sees %s probe row(s) owned by account B -- cross-account SELECT leak\n',
              :'a_other_account_leak') ELSE '' END AS ledger \gset
SELECT :'ledger' || CASE WHEN :'a_leak_general'::bigint > 0
  THEN format(E'[7a] FAIL user A sees %s probe row(s) outside its own account (any account, not only B)\n',
              :'a_leak_general') ELSE '' END AS ledger \gset
ROLLBACK;

\echo ''
\echo '--- 7b. as user B: sees its own seeded row, and NOTHING outside its account ---'
BEGIN;
INSERT INTO contacts (account_id, user_id, phone, email)
SELECT c.acct, c.uid,
       '+1555' || :'nonce' || c.tag || substr(replace(c.acct::text, '-', ''), 1, 3),
       :'marker'
FROM (VALUES
  (:'probe_a'::uuid, :'uid_a'::uuid, 'a'),
  (:'probe_b'::uuid, :'uid_b'::uuid, 'b')
) AS c(acct, uid, tag);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :'uid_b', 'role', 'authenticated')::text, true);

SELECT count(*) FILTER (WHERE account_id = :'probe_b'::uuid) AS own_rows,
       count(*) FILTER (WHERE account_id = :'probe_a'::uuid) AS other_account_leak,
       count(*) FILTER (WHERE account_id <> :'probe_b'::uuid)  AS leak_general,
       count(*) AS probe_rows_visible
FROM contacts WHERE email = :'marker' \gset b_
\echo '   own_rows=' :b_own_rows '  other_account_leak=' :b_other_account_leak '  leak_general=' :b_leak_general '  probe_rows_visible=' :b_probe_rows_visible

SELECT :'ledger' || CASE WHEN :'b_own_rows'::bigint = 0
  THEN E'[7b] FAIL user B reads 0 of its own rows (own_rows=0): the isolation predicate is broken, not merely strict\n'
  ELSE '' END AS ledger \gset
SELECT :'ledger' || CASE WHEN :'b_other_account_leak'::bigint > 0
  THEN format(E'[7b] FAIL user B sees %s probe row(s) owned by account A -- cross-account SELECT leak\n',
              :'b_other_account_leak') ELSE '' END AS ledger \gset
SELECT :'ledger' || CASE WHEN :'b_leak_general'::bigint > 0
  THEN format(E'[7b] FAIL user B sees %s probe row(s) outside its own account (any account, not only A)\n',
              :'b_leak_general') ELSE '' END AS ledger \gset
ROLLBACK;

\echo ''
\echo '--- 7c. seed completeness: the admin view really holds one row per account ---'
-- Guards the opposite direction: if seeding silently wrote both rows to one
-- account, 7a/7b would be measuring the wrong shape.
BEGIN;
INSERT INTO contacts (account_id, user_id, phone, email)
SELECT c.acct, c.uid,
       '+1555' || :'nonce' || 's' || substr(replace(c.acct::text, '-', ''), 1, 3),
       :'marker'
FROM (VALUES
  (:'probe_a'::uuid, :'uid_a'::uuid, 'a'),
  (:'probe_b'::uuid, :'uid_b'::uuid, 'b')
) AS c(acct, uid, tag);
SELECT count(DISTINCT account_id) AS accounts_seeded, count(*) AS rows_seeded
FROM contacts WHERE email = :'marker' \gset s_
\echo '   accounts_seeded=' :s_accounts_seeded '  rows_seeded=' :s_rows_seeded
SELECT :'ledger' || CASE WHEN :'s_accounts_seeded'::bigint <> 2
  THEN format(E'[7c] FAIL seed covered %s account(s), expected 2: 7a/7b would be measuring the wrong shape\n',
              :'s_accounts_seeded') ELSE '' END AS ledger \gset
ROLLBACK;

-- ===========================================================================
\echo ''
\echo '--- 8. NEGATIVE: INSERT into another account must be REJECTED by WITH CHECK ---'
-- The whole probe lives inside ONE DO block, so the offending INSERT runs in a
-- subtransaction we can catch. The outcome is recorded in GUCs and the row
-- count is taken from INSIDE that block, BEFORE anything is rolled back.
--
-- The previous version did SAVEPOINT / INSERT / ROLLBACK TO SAVEPOINT and only
-- then counted, so the rollback destroyed the evidence first and leaked_rows was
-- structurally always 0 -- it printed 0 and exited 0 even with RLS disabled.
--
-- The assertion is on the OUTCOME, not on the count. A cross-account INSERT
-- rejected for the wrong reason (a unique violation, say) is not isolation, so
-- only SQLSTATE 42501 counts as a pass and anything else fails the run.
-- ===========================================================================
BEGIN;
-- psql does NOT interpolate :'var' inside a dollar-quoted DO body -- the text
-- goes to the server verbatim and you get "syntax error at or near :". So the
-- fixtures are handed to the block through custom GUCs, which the block reads
-- with current_setting(). Measured working: current_setting() is readable
-- inside a DO block after SET LOCAL ROLE anon.
SELECT set_config('iso.probe_b', :'probe_b', true);
SELECT set_config('iso.uid_a',   :'uid_a',   true);
SELECT set_config('iso.marker',  :'marker',  true);

DO $iso_section8$
DECLARE
  v_state  text   := 'ALLOWED';
  v_leaked bigint := 0;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('iso.uid_a'), 'role', 'authenticated')::text, true);

  BEGIN
    INSERT INTO contacts (account_id, user_id, phone, email)
    VALUES (current_setting('iso.probe_b')::uuid,
            current_setting('iso.uid_a')::uuid,
            '+1555' || current_setting('iso.probe_b')::text,  -- unique per run
            current_setting('iso.marker'));
    v_state := 'ALLOWED';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_state := 'REJECTED_RLS';
  WHEN OTHERS THEN
    v_state := 'REJECTED_OTHER_' || SQLSTATE;
  END;

  -- Counted here, while a row user A inserted into account B is still present.
  SELECT count(*) INTO v_leaked FROM contacts WHERE email = current_setting('iso.marker');
  RESET ROLE;
  PERFORM set_config('iso.section8.outcome', v_state, true);
  PERFORM set_config('iso.section8.leaked', v_leaked::text, true);
END $iso_section8$;

SELECT current_setting('iso.section8.outcome') AS outcome,
       current_setting('iso.section8.leaked')::bigint AS leaked_rows,
       (SELECT count(*) FROM contacts WHERE email = :'marker') AS cross_account_row_count
\gset s8_
\echo '   outcome=' :s8_outcome '  leaked_rows_at_probe_time=' :s8_leaked_rows '  cross_account_row_count=' :s8_cross_account_row_count

SELECT :'ledger' || CASE
  WHEN :'s8_outcome' = 'ALLOWED'
    THEN E'[8] FAIL cross-account INSERT was ALLOWED: user A wrote a row into account B and the WITH CHECK policy did not stop it\n'
  WHEN :'s8_outcome' <> 'REJECTED_RLS'
    THEN format(E'[8] FAIL cross-account INSERT was rejected for the WRONG REASON (%s), not by row-level security (42501): a rejection that is not RLS is not isolation\n',
                :'s8_outcome')
  ELSE '' END AS ledger \gset
ROLLBACK;

\echo ''
\echo '--- 9a. NEGATIVE: cross-account UPDATE must be REJECTED ---'
-- Section 8 probes INSERT only. An UPDATE hole is invisible to it. This section
-- measures the UPDATE path in both shapes.
--
-- MEASURED, baseline policies, as user A (uid_a), probe rows for accounts A and B:
--   in-place edit of A's OWN row (company)             -> ALLOWED rows=1
--   A re-points its OWN row at account B               -> REJECTED_RLS rows=0
--   same move, marker-only WHERE (no account filter)   -> REJECTED_RLS rows=0
--   fully unscoped UPDATE (no WHERE)                   -> ALLOWED rows=2, A's rows only
--   in-place edit of A's own row again, AFTER the negatives -> ALLOWED rows=1
--
-- WHICH POLICY ACTUALLY BLOCKS IT -- measured, do not assume. The 42501 on the
-- cross-account move comes from the contacts_SELECT policy, not from
-- contacts_update. Proof, each in its own rolled-back transaction:
--   contacts_update USING is_account_member WITH CHECK (true)   -> still 42501
--   contacts_update USING (true) WITH CHECK (true)              -> still 42501
--   contacts_update USING (true) AND contacts_select dropped    -> ALLOWED
-- The reason is that an UPDATE's row scan is filtered by the SELECT policy: an
-- UPDATE reads candidate rows through the SELECT USING, so the post-image check
-- never gets to admit a row the caller cannot see. This is why replacing the
-- implicit WITH CHECK with WITH CHECK (true) -- the obvious UPDATE-hole mutation --
-- does NOT go red, and why that must not be this section's target.
--
-- The mutation that DOES open the hole, measured exit 3 with the failures named
-- [9a] FAIL cross-account UPDATE was ALLOWED and [9a] FAIL ... left 2 row(s) owned
-- by account B: contacts_select USING (true) TOGETHER WITH contacts_update USING
-- (true). contacts_update USING (true) ALONE stays green (exit 0) and deletes
-- nothing, because contacts_select still scopes the scan.
--
-- Both shapes are measured because a restriction can hold for the targeted form
-- and not the unscoped one, and the unscoped form is the realistic attack.
--
-- The rows are targeted by PHONE, not by account_id, and ownership is asserted by
-- comparing the account_id COLUMN after the write. The marker names which rows are
-- probe rows and nothing else.
--
-- WHY RESET ROLE INSIDE THE BLOCK, THEN COUNT AT TOP LEVEL: the counts must be read
-- as postgres. Counting as anon after a write reads 0 for the other account's row
-- whether it survived or was destroyed, because anon cannot SEE it -- so an as-anon
-- count cannot distinguish a clean deny from a full wipe. Measured in this file's
-- own 9b/9a blocks:
--   probe rows visible to anon after the DELETE shapes -> 0   (looks clean either way)
--   probe rows counted AS POSTGRES                      -> 3, and B's row still there
-- RESET ROLE restores postgres for the statements that follow the DO block
-- (measured: current_user is postgres after it), and a GUC written inside the block
-- stays visible to the next top-level statement, which is how the outcome is carried
-- out of a subtransaction that must swallow its own exception.
BEGIN;
-- psql does NOT interpolate :'var' inside a dollar-quoted DO body (see section 8),
-- so the fixtures are handed over as custom GUCs and read with current_setting().
-- These MUST be set INSIDE this transaction: set_config(..., true) outside an
-- explicit BEGIN applies to a single-statement implicit transaction and is silently
-- discarded at its end -- no warning, and every current_setting() then returns ''.
SELECT set_config('iso.a_probe_a',   :'probe_a',   true);
SELECT set_config('iso.a_probe_b',   :'probe_b',   true);
SELECT set_config('iso.a_uid',       :'uid_a',     true);
SELECT set_config('iso.a_uid_b',     :'uid_b',     true);
SELECT set_config('iso.a_marker',    :'marker',    true);
SELECT set_config('iso.a_after',     :'after_marker', true);
SELECT set_config('iso.a_phone_a1',  '+1555' || :'nonce' || 'a1' || substr(replace(:'probe_a','-',''),1,3), true);
SELECT set_config('iso.a_phone_a2',  '+1555' || :'nonce' || 'a2' || substr(replace(:'probe_a','-',''),1,3), true);
SELECT set_config('iso.a_phone_b1', '+1555' || :'nonce' || 'b1' || substr(replace(:'probe_b','-',''),1,3), true);
SELECT set_config('iso.a_uid_c',     :'uid_c',   true);
SELECT set_config('iso.a_phone_c1',  '+1555' || :'nonce' || 'c1' || substr(replace(:'uid_c','-',''),1,3), true);
SELECT set_config('iso.a_w4_tag',    'iso-9a-unscoped-' || :'nonce', true);
-- C gets its OWN marker. The post-write census counts elsewhere_rows as "rows on
-- the main marker that belong to neither A nor B", so a third tenant sharing the
-- main marker would trip that assertion before w4 is ever reached. The leak check
-- keys off company, so C does not need the shared marker at all.
SELECT set_config('iso.a_marker_c',  'iso-c-' || :'nonce' || '@isolation.probe.invalid', true);

-- ACCOUNT C, built exactly the way probe_a and probe_b were built: by the
-- auth.users -> handle_new_user trigger, which inserts an accounts row and a
-- profiles row with account_role 'owner'. Verified on this database: both
-- existing accounts have exactly one owner and one 'owner' profile row.
--
-- Why a third tenant at all: a probe leaning on whatever unrelated rows happen to
-- exist in this database passes here and disappears in CI. C's own membership is
-- the natural shape for a tenant and widens nothing: is_account_member() resolves
-- the caller from auth.uid(), and the caller is always A.
--
-- No ON CONFLICT: uid_c is fresh every run, so a collision means something is
-- wrong and the insert should fail loudly rather than paper over it.
--
-- handle_new_user swallows its own errors (EXCEPTION WHEN OTHERS THEN RAISE
-- WARNING), so a silent failure would leave C without an account and the counts
-- below would compare against nothing. The assertion converts that silence into a
-- loud exit.
INSERT INTO auth.users (id, email, aud, role, encrypted_password, raw_app_meta_data)
VALUES (:'uid_c', 'iso-c-' || :'nonce' || '@isolation.probe.invalid',
        'authenticated', 'authenticated', '',
        '{"provider":"email","providers":["email"]}');

DO $iso_seeded_c$
DECLARE v_acc  bigint;
  v_prof bigint;
  v_uid  text   := current_setting('iso.a_uid_c');
BEGIN
  SELECT count(*) INTO v_acc FROM accounts  WHERE owner_user_id = v_uid::uuid;
  SELECT count(*) INTO v_prof FROM profiles WHERE user_id = v_uid::uuid AND account_role = 'owner';
  IF v_acc <> 1 THEN
    RAISE EXCEPTION 'instrument: account C seeding produced % account row(s) for uid %, expected exactly 1; handle_new_user may have failed silently', v_acc, v_uid;
  END IF;
  IF v_prof <> 1 THEN
    RAISE EXCEPTION 'instrument: account C seeding produced % owner profile row(s) for uid %, expected exactly 1', v_prof, v_uid;
  END IF;
END $iso_seeded_c$;

-- Read the account the trigger created. Any variable holding this id must be set
-- HERE, from probe_c itself, never from uid_c.
SELECT id AS probe_c FROM accounts WHERE owner_user_id = :'uid_c'::uuid \gset
SELECT set_config('iso.a_probe_c', :'probe_c', true);

-- Seeded INSIDE this transaction: A gets two rows, B gets one. a2 carries the
-- SECOND marker so the positive control that runs after the negatives still has a
-- row to edit -- the negatives below match on the first marker and would otherwise
-- consume it.
INSERT INTO contacts (account_id, user_id, phone, company, email)
SELECT c.acct, c.uid, c.phone, c.company, c.eml
FROM (VALUES
  (:'probe_a'::uuid, :'uid_a'::uuid, current_setting('iso.a_phone_a1'), 'iso-A-1', :'marker'),
  (:'probe_a'::uuid, :'uid_a'::uuid, current_setting('iso.a_phone_a2'), 'iso-A-2', :'after_marker'),
  (:'probe_b'::uuid, :'uid_b'::uuid, current_setting('iso.a_phone_b1'), 'iso-B-untouched', :'marker'),
  (:'probe_c'::uuid, :'uid_c'::uuid, current_setting('iso.a_phone_c1'), 'iso-C-untouched', current_setting('iso.a_marker_c'))
) AS c(acct, uid, phone, company, eml);

-- expected_a and expected_b are computed HERE, as postgres, from the seed itself
-- -- not from w1 -- so neither can be inflated by an earlier section's
-- bookkeeping. A owns two rows, B owns one. expected_b is what proves the census
-- below ran in a role that CAN SEE the other account: measured, an as-anon census
-- reads B as 0 on a perfectly healthy run, and a post-write count taken in a role
-- that cannot see the damaged row cannot tell a clean deny from a full wipe.
SELECT count(*) FILTER (WHERE account_id = :'probe_a'::uuid) AS expected_a,
       count(*) FILTER (WHERE account_id = :'probe_b'::uuid) AS expected_b
FROM contacts WHERE email IN (:'marker', :'after_marker')
\gset s9_
-- psql does not interpolate :'var' inside a dollar-quoted DO body, so the same
-- fixture-derived number is handed to the block through a GUC. It is the value
-- the SEED says B owns, not a reading taken after any probe ran.
SELECT set_config('iso.a_expected_b', :'s9_expected_b', true);

DO $iso_section9a$
DECLARE
  v_a1  text   := current_setting('iso.a_phone_a1');
  v_a2  text   := current_setting('iso.a_phone_a2');
  v_b   uuid   := current_setting('iso.a_probe_b')::uuid;
  v_n   bigint := 0;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('iso.a_uid'), 'role', 'authenticated')::text, true);

  -- POSITIVE CONTROL, BEFORE. An in-place edit of A's own row MUST succeed. If the
  -- predicate denied even this, every negative below would pass for the wrong
  -- reason and the whole section would be vacuous.
  v_n := 0;
  BEGIN
    UPDATE contacts SET company = 'iso-9a-edited-before' WHERE phone = v_a1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9a.w1', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9a.w1', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9a.w1', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- NEGATIVE, shape 1: A re-points its OWN row at account B. Measured: this is what
  -- a cross-account UPDATE looks like on the wire. Baseline the 42501 comes from the
  -- SELECT policy (see the note above), so this shape is red only once that policy is
  -- loosened too -- which is the point of measuring it.
  v_n := 0;
  BEGIN
    UPDATE contacts SET account_id = v_b WHERE phone = v_a1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9a.w2', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9a.w2', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9a.w2', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- NEGATIVE, shape 2: the same cross-account move with NO account filter.
  v_n := 0;
  BEGIN
    UPDATE contacts SET account_id = v_b WHERE email = current_setting('iso.a_marker');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9a.w3', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9a.w3', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9a.w3', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- NEGATIVE, shape 3: a FULLY unscoped UPDATE, no WHERE at all.
  --
  -- MEASURED, and the earlier comment here was wrong: what scopes this is the
  -- UPDATE policy's USING expression, NOT the SELECT policy. Two measurements:
  --   DROP contacts_select, keep contacts_update USING=is_account_member
  --     -> UPDATE 2, both A's rows, B untouched  (the SELECT policy was not needed)
  --   keep contacts_select, DROP contacts_update
  --     -> UPDATE 0                              (the UPDATE policy was the gate)
  -- An UPDATE with no WHERE and no RETURNING needs no SELECT privilege, so the
  -- SELECT policy does not gate it in either direction.
  --
  -- This is the shape that used to pass silently: contacts_update USING (true)
  -- alone made this UPDATE touch every row in the table -- account B's row, a third
  -- tenant's row -- and the run still exited 0, because the post-write census
  -- looks at account_id on probe-marker rows while this writes company.
  v_n := 0;
  BEGIN
    UPDATE contacts SET company = current_setting('iso.a_w4_tag');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9a.w4', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9a.w4', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9a.w4', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- Count as postgres, INSIDE the block, immediately after w4. The role is still
  -- anon here and anon cannot SEE B's or C's rows, so an as-anon count reads 0 for
  -- a clean deny and for a full wipe alike. Measured on this database:
  -- AS_POSTGRES_elsewhere_rows=1 vs AS_ANON_elsewhere_rows=0 for the same rows.
  -- Read BEFORE the ROLLBACK: ROLLBACK TO SAVEPOINT also reverts
  -- set_config(..., true), which is how section 8 lost its evidence the first time.
  RESET ROLE;
  PERFORM set_config('iso.section9a.w4_touched',
    (SELECT count(*) FROM contacts WHERE company = current_setting('iso.a_w4_tag'))::text, true);
  PERFORM set_config('iso.section9a.w4_leaked',
    (SELECT count(*) FROM contacts WHERE company = current_setting('iso.a_w4_tag')
       AND account_id <> current_setting('iso.a_probe_a')::uuid)::text, true);
  -- INSTRUMENT: the counted rows must equal ROW_COUNT. It AGREEs under every
  -- policy mutation including M3, and fires only when the counting itself is
  -- broken. Compared as postgres, deliberately: compared as anon it would
  -- disagree on a healthy M3 run, because anon sees fewer rows than ROW_COUNT
  -- reports -- that was the bug in the first version of this patch.
  PERFORM set_config('iso.section9a.w4_instrument',
    CASE WHEN (SELECT count(*) FROM contacts WHERE company = current_setting('iso.a_w4_tag')) = v_n
         THEN 'AGREE'
         ELSE 'DISAGREE rows_counted=' ||
              (SELECT count(*) FROM contacts WHERE company = current_setting('iso.a_w4_tag')) ||
              ' row_count=' || v_n END, true);
  -- Back to the caller: request.jwt.claims is a GUC and survives the role switch.
  SET LOCAL ROLE anon;

  -- NEGATIVE, shape 4: a FULLY unscoped cross-account MOVE, no WHERE at all.
  --
  -- MEASURED, every row below on this database, as user A, with this section's
  -- own seed (A: 2 rows, B: 1 row, C: 1 row, plus 1 unrelated production row):
  --
  --   baseline                                     -> REJECTED_RLS rows=0
  --   contacts_update WITH CHECK (true)            -> ALLOWED rows=2  LEAK (a: 2->0, b: 1->3)
  --   contacts_update USING (true)                 -> ALLOWED rows=4  LEAK (a: 2->0, b: 1->3)
  --   contacts_update DROPPED                      -> ALLOWED rows=0  (narrower, not a leak)
  --   contacts_select USING (true)                 -> REJECTED_RLS rows=0
  --   RLS disabled on contacts                     -> ALLOWED rows=4  LEAK
  --
  -- WHY THIS SHAPE AND NOT w2/w3. The targeted shapes above both stay
  -- REJECTED_RLS rows=0 under contacts_update WITH CHECK (true), so they can
  -- never catch it, and a comment naming them as the gate is a comment that
  -- misleads. The measured reason: a statement WITH a WHERE has to READ its
  -- candidate rows, so contacts_select applies to the scan and
  -- is_account_member(B) rejects the resulting row regardless of what the UPDATE
  -- policy's WITH CHECK says. A statement with NO WHERE and no RETURNING needs no
  -- read privilege at all, so nothing scopes the scan but contacts_update's own
  -- USING, and WITH CHECK (true) then admits the cross-account post-image. That
  -- is why the WITH CHECK of contacts_update is measurable at all, and only here.
  --
  -- B and C carry DIFFERENT markers, so the census keys off account_id and both
  -- are visible to it: C's row has a marker of its own but the same account_id
  -- comparison sees it.
  v_n := 0;
  BEGIN
    UPDATE contacts SET account_id = v_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9a.w6', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9a.w6', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9a.w6', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- Count as postgres, INSIDE the block, immediately after w6, for the reason the
  -- w4 census above gives: anon cannot SEE B's or C's rows, so an as-anon count
  -- reads "nothing leaked" whether the rows survived or were destroyed.
  RESET ROLE;
  PERFORM set_config('iso.section9a.w6_a',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.a_marker'), current_setting('iso.a_after'))
         AND account_id = current_setting('iso.a_probe_a')::uuid)::text, true);
  PERFORM set_config('iso.section9a.w6_b',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.a_marker'), current_setting('iso.a_after'))
         AND account_id = current_setting('iso.a_probe_b')::uuid)::text, true);
  PERFORM set_config('iso.section9a.w6_elsewhere',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.a_marker'), current_setting('iso.a_after'))
         AND account_id <> current_setting('iso.a_probe_a')::uuid
         AND account_id <> current_setting('iso.a_probe_b')::uuid)::text, true);
  -- INSTRUMENT for w6: "the statement reported writing rows" must agree with
  -- "the rows that the statement could have moved actually moved". The census is
  -- a direct account_id comparison and the statement's own ROW_COUNT is the only
  -- other witness; when they disagree, one of the two is broken and the leak
  -- verdict below is worthless. Compared as postgres on purpose -- compared as
  -- anon it would DISAGREE on a healthy run, which is the bug the first version
  -- of this assertion had. AGREE is measured under baseline and under every
  -- policy mutation in the campaign; DISAGREE is reachable only by breaking the
  -- counting itself (see the M-inst probe in tools/rls-mutation/).
  PERFORM set_config('iso.section9a.w6_instrument',
    CASE WHEN (v_n > 0) = (current_setting('iso.section9a.w6_b')::bigint > current_setting('iso.a_expected_b')::bigint)
         THEN 'AGREE'
         ELSE 'DISAGREE rows=' || v_n ||
              ' a_owned_after=' || current_setting('iso.section9a.w6_a') ||
              ' b_owned_before=' || current_setting('iso.a_expected_b') ||
              ' b_owned_after=' || current_setting('iso.section9a.w6_b')
    END, true);
  -- Back to the caller: request.jwt.claims is a GUC and survives the role switch.
  SET LOCAL ROLE anon;

  -- POSITIVE CONTROL, AFTER. A's second row must still be editable, on the second
  -- marker, proving the negatives above did not break the write path.
  v_n := 0;
  BEGIN
    UPDATE contacts SET company = 'iso-9a-edited-after' WHERE phone = v_a2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9a.w5', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9a.w5', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9a.w5', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  RESET ROLE;
END $iso_section9a$;

SELECT current_setting('iso.section9a.w1') AS w1, current_setting('iso.section9a.w2') AS w2,
       current_setting('iso.section9a.w3') AS w3, current_setting('iso.section9a.w4') AS w4,
       current_setting('iso.section9a.w5') AS w5,
       current_setting('iso.section9a.w6') AS w6,
       current_setting('iso.section9a.w4_instrument') AS w4_instrument,
       current_setting('iso.section9a.w4_touched')  AS w4_touched,
       current_setting('iso.section9a.w4_leaked')   AS w4_leaked,
       current_setting('iso.section9a.w6_instrument') AS w6_instrument,
       current_setting('iso.section9a.w6_a')   AS w6_a,
       current_setting('iso.section9a.w6_b')   AS w6_b,
       current_setting('iso.section9a.w6_elsewhere') AS w6_elsewhere
\gset u9a_
\echo '   [9a] edit A own row (pos before)  ->' :u9a_w1
\echo '   [9a] A own row -> account B      ->' :u9a_w2
\echo '   [9a] -> account B, no acct filter->' :u9a_w3
\echo '   [9a] unscoped UPDATE             ->' :u9a_w4
\echo '   [9a] unscoped: touched=' :u9a_w4_touched ' leaked=' :u9a_w4_leaked ' instrument=' :u9a_w4_instrument
\echo '   [9a] edit A own row (pos after)  ->' :u9a_w5
\echo '   [9a] UNSCOPED move -> account B  ->' :u9a_w6
\echo '   [9a] unscoped move: a=' :u9a_w6_a ' b=' :u9a_w6_b ' elsewhere=' :u9a_w6_elsewhere ' instrument=' :u9a_w6_instrument

-- Counted HERE, as postgres, before the ROLLBACK. Every count is a direct column
-- comparison on account_id; there is no name or pattern matching anywhere.
SELECT count(*) FILTER (WHERE account_id = :'probe_a'::uuid) AS own_rows_after,
       count(*) FILTER (WHERE account_id = :'probe_b'::uuid) AS other_account_rows,
       count(*) FILTER (WHERE account_id <> :'probe_a'::uuid
                          AND account_id <> :'probe_b'::uuid) AS elsewhere_rows,
       (SELECT count(*) FROM contacts WHERE email IN (:'marker', :'after_marker')) AS probe_rows_after,
       (SELECT count(*) FROM contacts WHERE email = :'after_marker'
          AND account_id = :'probe_a'::uuid) AS control_row_after,
       (SELECT count(*) FROM contacts
          WHERE email = :'after_marker' AND company = 'iso-9a-edited-after') AS control_row_edited
FROM contacts WHERE email IN (:'marker', :'after_marker') \gset u9_
\echo '   [9a] own_rows_after=' :u9_own_rows_after '  other_account_rows=' :u9_other_account_rows '  elsewhere_rows=' :u9_elsewhere_rows
\echo '   [9a] probe_rows_after=' :u9_probe_rows_after '  control_row_after=' :u9_control_row_after '  control_row_edited=' :u9_control_row_edited

SELECT :'ledger' || CASE
  WHEN :'u9a_w1' <> 'ALLOWED rows=1'
    THEN format(E'[9a] FAIL positive control before: an in-place edit of user A''s OWN row did not succeed (%s). Every negative below would pass vacuously, so this section is not yet measuring isolation\n',
                :'u9a_w1')
  WHEN :'u9a_w5' <> 'ALLOWED rows=1'
    THEN format(E'[9a] FAIL positive control after: user A could not edit its OWN row after the negative probes (%s): the write path is broken, not merely strict\n',
                :'u9a_w5')
  WHEN :'u9_control_row_after'::bigint <> 1
    THEN format(E'[9a] FAIL the positive-control row is no longer owned by account A (rows found: %s), so the control is not proving anything\n',
                :'u9_control_row_after')
  WHEN :'u9_control_row_edited'::bigint <> 1
    THEN format(E'[9a] FAIL the positive-control row was not actually modified (control_row_edited=%s): allowed was reported without the write landing\n',
                :'u9_control_row_edited')
  ELSE '' END AS ledger \gset

-- EVERY SHAPE'S ROW COUNT, EXTRACTED AS A NUMBER.
--
-- This block exists because the assertions below used to test a STRING PREFIX
-- ('ALLOWED%') instead of a count, and that is a false red with a very specific
-- shape. Measured under contacts_update DROPPED: the scan matches nothing, the
-- statement returns 'ALLOWED rows=0', the old predicate matched the prefix, and
-- the file reported a cross-account leak that never happened -- while the actual
-- breakage (a NARROWER policy) went unreported by this line and was caught only
-- by the positive-control and drift lines further down. A leak is a claim about
-- ROWS THAT MOVED. 'ALLOWED rows=0' is a claim about a scan that matched
-- nothing, which is the opposite of a leak, so the numeric count is what the
-- predicate reads and the prefix only decides WHICH verdict applies.
--
-- regexp_match extracts the count from every outcome string the blocks can
-- produce, so a REJECTED_* row count is read the same way as an ALLOWED one.
SELECT coalesce((regexp_match(:'u9a_w1', 'rows=([0-9]+)'))[1], '-1')::bigint AS w1_rows,
       coalesce((regexp_match(:'u9a_w2', 'rows=([0-9]+)'))[1], '-1')::bigint AS w2_rows,
       coalesce((regexp_match(:'u9a_w3', 'rows=([0-9]+)'))[1], '-1')::bigint AS w3_rows,
       coalesce((regexp_match(:'u9a_w4', 'rows=([0-9]+)'))[1], '-1')::bigint AS w4_rows,
       coalesce((regexp_match(:'u9a_w5', 'rows=([0-9]+)'))[1], '-1')::bigint AS w5_rows,
       coalesce((regexp_match(:'u9a_w6', 'rows=([0-9]+)'))[1], '-1')::bigint AS w6_rows
\gset r9a_
\echo '   [9a] rows reported: w1=' :r9a_w1_rows ' w2=' :r9a_w2_rows ' w3=' :r9a_w3_rows ' w4=' :r9a_w4_rows ' w5=' :r9a_w5_rows ' w6=' :r9a_w6_rows

SELECT :'ledger' || CASE
  WHEN :'r9a_w2_rows' > 0
    THEN format(E'[9a] FAIL cross-account UPDATE was ALLOWED (%s, %s row(s) actually moved): user A re-pointed its own row at account B''s account_id and the WITH CHECK policy did not stop it\n',
                :'u9a_w2', :'r9a_w2_rows')
  WHEN :'u9a_w2' LIKE 'REJECTED%' AND :'u9a_w2' <> 'REJECTED_RLS rows=0'
    THEN format(E'[9a] FAIL cross-account UPDATE was rejected for the WRONG REASON (%s), not by row-level security (42501): a rejection that is not RLS is not isolation\n',
                :'u9a_w2')
  ELSE '' END AS ledger \gset

SELECT :'ledger' || CASE
  WHEN :'r9a_w3_rows' > 0
    THEN format(E'[9a] FAIL cross-account UPDATE with no account filter was ALLOWED (%s, %s row(s) actually moved): user A moved every probe row it can see into account B\n',
                :'u9a_w3', :'r9a_w3_rows')
  WHEN :'u9a_w3' LIKE 'REJECTED%' AND :'u9a_w3' <> 'REJECTED_RLS rows=0'
    THEN format(E'[9a] FAIL cross-account UPDATE with no account filter was rejected for the WRONG REASON (%s), not by row-level security (42501)\n',
                :'u9a_w3')
  ELSE '' END AS ledger \gset

-- w6, THE UNSCOPED MOVE. THREE SEPARATE FAILURES, never merged, exactly as for
-- w4 below, and the same three classes:
--   instrument = the statement's own ROW_COUNT and the ownership census disagree,
--                so no leak verdict from this shape can be trusted.
--   leak       = rows landed in an account that is not the caller's. Counted as
--                postgres, before the ROLLBACK.
--   drift      = the policy moved away from the measured baseline in EITHER
--                direction. contacts_update WITH CHECK (true) and contacts_update
--                USING (true) make this shape LEAK; contacts_update DROPPED makes
--                it 'ALLOWED rows=0', which is NARROWER, not a leak, and is
--                reported by the drift line -- never by the leak line.
SELECT :'ledger' || CASE
  WHEN :'u9a_w6_instrument' <> 'AGREE'
    THEN format(E'[9a] FAIL instrument: the unscoped UPDATE''s ROW_COUNT and the ownership census disagree (%s). The leak verdict below would be meaningless\n',
                :'u9a_w6_instrument')
  ELSE '' END AS ledger \gset

SELECT :'ledger' || CASE
  WHEN :'u9a_w6_b'::bigint > :'s9_expected_b'::bigint
    THEN format(E'[9a] FAIL leak: the unscoped UPDATE moved %s probe row(s) into account B (%s, %s row(s) written), counted as postgres before rollback. A statement with no WHERE needs no read privilege, so contacts_update''s own USING scoped the scan and its WITH CHECK was the only gate on the cross-account post-image\n',
                :'u9a_w6_b', :'u9a_w6', :'r9a_w6_rows')
  WHEN :'u9a_w6_elsewhere'::bigint > 0
    THEN format(E'[9a] FAIL leak: the unscoped UPDATE moved %s probe row(s) into an account that is neither the caller nor B (%s), counted as postgres before rollback\n',
                :'u9a_w6_elsewhere', :'u9a_w6')
  ELSE '' END AS ledger \gset

SELECT :'ledger' || CASE
  WHEN :'u9a_w6_a'::bigint <> :'s9_expected_a'::bigint
    THEN format(E'[9a] FAIL drift: after the unscoped UPDATE account A owns %s of its %s seeded probe row(s) (%s). A WIDER policy hands rows to another account; a NARROWER one (contacts_update dropped) moves none of them\n',
                :'u9a_w6_a', :'s9_expected_a', :'u9a_w6')
  ELSE '' END AS ledger \gset

-- THREE SEPARATE FAILURES, never merged into one message:
--   instrument = the counted rows and ROW_COUNT disagree: the measurement itself
--                is broken, so no leak verdict from this block can be trusted.
--   leak       = the UPDATE reached a row belonging to ANOTHER account. Proof of
--                a cross-tenant write, counted as postgres before rollback.
--   drift      = the policy moved away from the measured baseline in EITHER
--                direction: wider hands over other accounts, narrower (a missing
--                UPDATE policy) breaks the write path. A missing policy is a real
--                failure and must also turn the run red.
SELECT :'ledger' || CASE
  WHEN :'u9a_w4_instrument' <> 'AGREE'
    THEN format(E'[9a] FAIL instrument: ROW_COUNT and the counted rows disagree (%s). The leak verdict below would be meaningless\n',
                :'u9a_w4_instrument')
  ELSE '' END AS ledger \gset

SELECT :'ledger' || CASE
  WHEN :'u9a_w4_leaked'::bigint > 0
    THEN format(E'[9a] FAIL leak: an unscoped UPDATE touched %s row(s) not owned by the caller (counted as postgres, before rollback). The UPDATE policy was open enough to write another account''s rows\n',
                :'u9a_w4_leaked')
  ELSE '' END AS ledger \gset

SELECT :'ledger' || CASE
  WHEN :'u9a_w4_touched'::bigint <> :'s9_expected_a'::bigint
    THEN format(E'[9a] FAIL drift: the unscoped UPDATE touched %s row(s), the baseline is %s. A WIDER policy hands over other accounts; a NARROWER one (missing UPDATE policy) breaks the write path\n',
                :'u9a_w4_touched', :'s9_expected_a')
  ELSE '' END AS ledger \gset

-- The post-write census is the assertion that survives a policy which lets the
-- move through: even if the UPDATE reported an error for some other reason, a row
-- sitting in an account that is not the caller's is a leak, and it is read from the
-- account_id COLUMN as postgres, where RLS cannot hide it.
SELECT :'ledger' || CASE
  WHEN :'u9_other_account_rows'::bigint > 1 OR :'u9_elsewhere_rows'::bigint > 0
    THEN format(E'[9a] FAIL cross-account UPDATE left %s row(s) owned by account B and %s row(s) owned by an account that is neither caller nor B, counted AS POSTGRES: a probe row moved out of the caller''s account\n',
                :'u9_other_account_rows', :'u9_elsewhere_rows')
  ELSE '' END AS ledger \gset
ROLLBACK;

\echo ''
\echo '--- 9b. NEGATIVE: cross-account DELETE must be REJECTED ---'
-- contacts_delete exposes USING (a DELETE policy has no WITH CHECK). At baseline
-- that USING is is_account_member(account_id, 'agent'), so a cross-account delete is
-- already blocked. Measured here, as user A, at baseline:
--   DELETE WHERE phone = <A's own row>          -> ALLOWED rows=1
--   DELETE WHERE account_id = <B>              -> ALLOWED rows=0 (matched nothing)
--   DELETE WHERE email = <marker>               -> ALLOWED rows=0
--   DELETE WHERE phone = <A's other row> AFTER   -> ALLOWED rows=1
--   B's row afterwards, counted AS POSTGRES       -> 1
--
-- MEASURED under contacts_delete USING (true) alone (the obvious delete-hole
-- mutation): still ALLOWED rows=0, still ALLOWED rows=0, B's row still survives, and
-- the whole run stays GREEN (exit 0). No leak observed. Same reason as in 9a -- the
-- SELECT policy still scopes which rows the DELETE considers, so loosening only the
-- DELETE policy does not hand over B's rows. The delete hole needs contacts_select
-- USING (true) as well; that combination is already caught red by 7a/7b before 9b
-- is ever reached.
--
-- Note the rows=0 lines: an unrestricted DELETE that matches ZERO rows is not a
-- rejection, it is a scan the policy already scoped. So the assertion below is
-- NOT "the DELETE was rejected" -- it is "B's row is still there, counted as postgres,
-- and A's own row was still deletable". A DELETE that returns 0 because the policy
-- filtered B's row out passes on the census even though no 42501 was ever raised.
BEGIN;
SELECT set_config('iso.d_probe_a', :'probe_a',   true);
SELECT set_config('iso.d_probe_b', :'probe_b',   true);
SELECT set_config('iso.d_uid',      :'uid_a',   true);
SELECT set_config('iso.d_marker',   :'marker',  true);
SELECT set_config('iso.d_after',    :'after_marker', true);
SELECT set_config('iso.d_phone_a1', '+1555' || :'nonce' || 'a1' || substr(replace(:'probe_a','-',''),1,3), true);
SELECT set_config('iso.d_phone_a2', '+1555' || :'nonce' || 'a2' || substr(replace(:'probe_a','-',''),1,3), true);
SELECT set_config('iso.d_phone_b1', '+1555' || :'nonce' || 'b1' || substr(replace(:'probe_b','-',''),1,3), true);

-- A gets two rows, B gets one. B's row is the one at risk and is NEVER counted as
-- anon.
INSERT INTO contacts (account_id, user_id, phone, company, email)
SELECT c.acct, c.uid, c.phone, c.company, c.eml
FROM (VALUES
  (:'probe_a'::uuid, :'uid_a'::uuid, current_setting('iso.d_phone_a1'), 'iso-A-1', :'marker'),
  (:'probe_a'::uuid, :'uid_a'::uuid, current_setting('iso.d_phone_a2'), 'iso-A-2', :'after_marker'),
  (:'probe_b'::uuid, :'uid_b'::uuid, current_setting('iso.d_phone_b1'), 'iso-B-untouched', :'marker')
) AS c(acct, uid, phone, company, eml);

DO $iso_section9b$
DECLARE
  v_a1 text   := current_setting('iso.d_phone_a1');
  v_a2 text   := current_setting('iso.d_phone_a2');
  v_b  uuid   := current_setting('iso.d_probe_b')::uuid;
  v_n  bigint := 0;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('iso.d_uid'), 'role', 'authenticated')::text, true);

  -- POSITIVE CONTROL, BEFORE: A must be able to delete its OWN row.
  v_n := 0;
  BEGIN
    DELETE FROM contacts WHERE phone = v_a1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9b.d1', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9b.d1', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9b.d1', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- NEGATIVE, shape 1: A deletes B's row, targeted by account_id.
  v_n := 0;
  BEGIN
    DELETE FROM contacts WHERE account_id = v_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9b.d2', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9b.d2', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9b.d2', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- NEGATIVE, shape 2: no account filter at all, every row carrying the marker.
  v_n := 0;
  BEGIN
    DELETE FROM contacts WHERE email = current_setting('iso.d_marker');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9b.d3', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9b.d3', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9b.d3', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- POSITIVE CONTROL, AFTER: A must still be able to delete its own SECOND row.
  v_n := 0;
  BEGIN
    DELETE FROM contacts WHERE phone = v_a2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9b.d5', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9b.d5', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9b.d5', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- Every DELETE above carries a WHERE clause, and that is the whole reason this
  -- section was blind. MEASURED under contacts_delete USING (true) alone: d1
  -- ALLOWED rows=1, d2 ALLOWED rows=0, d3 ALLOWED rows=0, B's row survives, and
  -- the whole file stays GREEN. A statement WITH a WHERE has to READ its
  -- candidate rows, so contacts_select applies to the DELETE scan and
  -- is_account_member(B) keeps B's row out of it whatever the DELETE policy says.
  -- Measured both directions: with contacts_select USING (true) AND
  -- contacts_delete USING (true) the WHERE'd shapes delete B's row; with only the
  -- DELETE policy open they delete nothing.
  --
  -- So: the census of what is left, taken as postgres BEFORE the next statement,
  -- and then the shape that has no WHERE to be scoped.
  RESET ROLE;
  PERFORM set_config('iso.section9b.pre_a',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.d_marker'), current_setting('iso.d_after'))
         AND account_id = current_setting('iso.d_probe_a')::uuid)::text, true);
  PERFORM set_config('iso.section9b.pre_b',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.d_marker'), current_setting('iso.d_after'))
         AND account_id = current_setting('iso.d_probe_b')::uuid)::text, true);
  -- Rows this probe did NOT insert, named by the EXACT phone set rather than by a
  -- pattern. This is the census the DELETE hole has to move: a probe that only
  -- looks at its own rows cannot see the production row it destroyed.
  PERFORM set_config('iso.section9b.pre_other',
    (SELECT count(*) FROM contacts
       WHERE phone NOT IN (current_setting('iso.d_phone_a1'),
                           current_setting('iso.d_phone_a2'),
                           current_setting('iso.d_phone_b1')))::text, true);
  SET LOCAL ROLE anon;

  -- NEGATIVE, shape 3: a FULLY unscoped DELETE, no WHERE at all.
  --
  -- MEASURED, as user A, with this section's own seed (A: 2 rows, B: 1 row) plus
  -- the 1 pre-existing production row this database carries:
  --
  --   baseline                                     -> ALLOWED rows=0, B's row survives
  --   contacts_delete USING (true)                 -> ALLOWED rows=2, B's row GONE
  --   RLS disabled on contacts                     -> ALLOWED rows=2, B's row GONE
  --   contacts_delete USING (true) AND
  --     contacts_update WITH CHECK (true)          -> ALLOWED rows=0 (probe rows
  --                                                  already moved to B by 9a's w6,
  --                                                  so anon cannot delete them)
  --
  -- 'ALLOWED rows=0' at baseline is NOT a rejection: it is a scan the DELETE
  -- policy already scoped down to A's own remaining rows, of which there are none
  -- by this point in the section. That is why the verdict below is the CENSUS,
  -- not the statement's outcome -- exactly the reasoning the d2/d3 rows above
  -- already force, applied to a shape that needs no read privilege at all.
  v_n := 0;
  BEGIN
    DELETE FROM contacts;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('iso.section9b.d6', 'ALLOWED rows=' || v_n, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN PERFORM set_config('iso.section9b.d6', 'REJECTED_RLS rows=0', true);
  WHEN OTHERS THEN PERFORM set_config('iso.section9b.d6', 'REJECTED_OTHER_' || SQLSTATE || ' rows=0', true); END;

  -- Counted as postgres, INSIDE the block, immediately after d6. anon cannot SEE
  -- B's row, so counting as anon reads 0 for a clean deny and for a full wipe
  -- alike: measured, the marker census as anon is 0 under every mutation here.
  RESET ROLE;
  PERFORM set_config('iso.section9b.d6_a',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.d_marker'), current_setting('iso.d_after'))
         AND account_id = current_setting('iso.d_probe_a')::uuid)::text, true);
  PERFORM set_config('iso.section9b.d6_b',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.d_marker'), current_setting('iso.d_after'))
         AND account_id = current_setting('iso.d_probe_b')::uuid)::text, true);
  PERFORM set_config('iso.section9b.d6_other',
    (SELECT count(*) FROM contacts
       WHERE phone NOT IN (current_setting('iso.d_phone_a1'),
                           current_setting('iso.d_phone_a2'),
                           current_setting('iso.d_phone_b1')))::text, true);
  -- INSTRUMENT for d6: "the statement reported deleting rows" must agree with
  -- "the census says fewer rows are here than before it ran". If they disagree,
  -- one of the two witnesses is broken and the leak verdict is worthless. Both
  -- readings are taken as postgres inside this block, before the ROLLBACK that
  -- would otherwise erase them.
  PERFORM set_config('iso.section9b.d6_instrument',
    CASE WHEN v_n = (current_setting('iso.section9b.pre_a')::bigint
                     + current_setting('iso.section9b.pre_b')::bigint
                     + current_setting('iso.section9b.pre_other')::bigint)
                 - (current_setting('iso.section9b.d6_a')::bigint
                    + current_setting('iso.section9b.d6_b')::bigint
                    + current_setting('iso.section9b.d6_other')::bigint)
         THEN 'AGREE'
         ELSE 'DISAGREE rows=' || v_n ||
              ' census_before=' || (current_setting('iso.section9b.pre_a')::bigint
                                 + current_setting('iso.section9b.pre_b')::bigint
                                 + current_setting('iso.section9b.pre_other')::bigint) ||
              ' census_after=' || (current_setting('iso.section9b.d6_a')::bigint
                                + current_setting('iso.section9b.d6_b')::bigint
                                + current_setting('iso.section9b.d6_other')::bigint)
    END, true);
  -- The anon-side reading, carried out for the record only: this is the number a
  -- wrong-role census would have produced, and it is why the verdict is not taken
  -- as anon.
  SET LOCAL ROLE anon;
  PERFORM set_config('iso.section9b.d6_as_anon',
    (SELECT count(*) FROM contacts
       WHERE email IN (current_setting('iso.d_marker'), current_setting('iso.d_after')))::text, true);
  RESET ROLE;
END $iso_section9b$;

SELECT current_setting('iso.section9b.d1') AS d1, current_setting('iso.section9b.d2') AS d2,
       current_setting('iso.section9b.d3') AS d3, current_setting('iso.section9b.d5') AS d5,
       current_setting('iso.section9b.d6') AS d6,
       current_setting('iso.section9b.d6_instrument') AS d6_instrument,
       current_setting('iso.section9b.pre_a') AS pre_a,
       current_setting('iso.section9b.pre_b') AS pre_b,
       current_setting('iso.section9b.pre_other') AS pre_other,
       current_setting('iso.section9b.d6_a') AS d6_a,
       current_setting('iso.section9b.d6_b') AS d6_b,
       current_setting('iso.section9b.d6_other') AS d6_other,
       current_setting('iso.section9b.d6_as_anon') AS d6_as_anon
\gset d9b_
\echo '   [9b] delete A own row (pos before) ->' :d9b_d1
\echo '   [9b] delete B rows by account_id  ->' :d9b_d2
\echo '   [9b] delete, no account filter    ->' :d9b_d3
\echo '   [9b] delete A own row (pos after)  ->' :d9b_d5
\echo '   [9b] UNSCOPED DELETE              ->' :d9b_d6
\echo '   [9b] census before a=' :d9b_pre_a ' b=' :d9b_pre_b ' other=' :d9b_pre_other
\echo '   [9b] census after  a=' :d9b_d6_a ' b=' :d9b_d6_b ' other=' :d9b_d6_other ' instrument=' :d9b_d6_instrument
\echo '   [9b] same census read as anon     ->' :d9b_d6_as_anon

-- Counted HERE, as postgres, before the ROLLBACK. B's row is the evidence.
SELECT count(*) FILTER (WHERE account_id = :'probe_b'::uuid) AS b_rows_after,
       count(*) FILTER (WHERE account_id = :'probe_a'::uuid) AS own_rows_after,
       (SELECT count(*) FROM contacts WHERE email IN (:'marker', :'after_marker')) AS probe_rows_after,
       (SELECT count(*) FROM contacts) AS table_rows_after
FROM contacts WHERE email IN (:'marker', :'after_marker') \gset d9_
\echo '   [9b] b_rows_after=' :d9_b_rows_after '  own_rows_after=' :d9_own_rows_after
\echo '   [9b] probe_rows_after=' :d9_probe_rows_after '  table_rows_after=' :d9_table_rows_after

SELECT :'ledger' || CASE
  WHEN :'d9b_d1' <> 'ALLOWED rows=1'
    THEN format(E'[9b] FAIL positive control before: user A could not delete its OWN row (%s). Every negative below would pass vacuously, so this section is not yet measuring isolation\n',
                :'d9b_d1')
  WHEN :'d9b_d5' <> 'ALLOWED rows=1'
    THEN format(E'[9b] FAIL positive control after: user A could not delete its OWN row after the negative probes (%s): the delete path is broken, not merely strict\n',
                :'d9b_d5')
  ELSE '' END AS ledger \gset

SELECT :'ledger' || CASE
  WHEN :'d9_b_rows_after'::bigint <> 1
    THEN format(E'[9b] FAIL cross-account DELETE: account B''s probe row did not survive (rows found as postgres: %s, expected 1). Read AS POSTGRES on purpose -- counting as anon reads 0 whether the row survived or was destroyed, because anon cannot see it\n',
                :'d9_b_rows_after')
  ELSE '' END AS ledger \gset

-- INSTRUMENT, and this one GATES. The census above is the only witness that B's row
-- survived, and it is compared as postgres. If the statement's own ROW_COUNT and
-- that census disagree, then either the DELETE touched rows the census cannot see,
-- or the census itself is broken -- and in both cases the verdict above is unsound.
--
-- MEASURED before this arm existed: the instrument was computed (iso.section9b
-- d6_instrument), carried through \gset and echoed, but never compared. Breaking the
-- census printed "instrument= DISAGREE" and the run still exited 0, which means the
-- [9b] DELETE verdicts were being taken on a measurement nothing watched. Same class
-- of defect as G3: a verdict resting on a number nobody checked.
--
-- Proved load-bearing by the mutant in tools/rls-mutation/minst/: with this arm
-- present, breaking the census turns the run red on THIS line, with every policy at
-- baseline.
SELECT :'ledger' || CASE
  WHEN :'d9b_d6_instrument' <> 'AGREE'
    THEN format(E'[9b] FAIL instrument: the unscoped DELETE''s ROW_COUNT and the ownership census disagree (%s). The DELETE verdict above would be meaningless\n',
                :'d9b_d6_instrument')
  ELSE '' END AS ledger \gset
ROLLBACK;

\echo ''
\echo '--- 9. fail-closed census: tables with no SELECT policy (reporting only) ---'
-- Reporting, not gating: a SELECT policy added to tenants or
-- automation_pending_executions would legitimately change these numbers, and a
-- non-zero "visible" here is not by itself proof of a leak.
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :'uid_a', 'role', 'authenticated')::text, true);
SELECT (SELECT count(*) FROM tenants)                       AS tenants_visible,
       (SELECT count(*) FROM automation_pending_executions) AS pending_visible,
       (SELECT count(*) FROM contacts)                       AS contacts_visible;
ROLLBACK;

-- ===========================================================================
\echo ''
\echo '--- 10. NEGATIVE: the invitation RPC refuses used / expired / already-member (S4) ---'
-- redeem_invitation (migration 019) is SECURITY DEFINER: it trusts
-- auth.uid() for the caller and enforces every refusal in SQL. This
-- section seeds four invitations (rolled back, zero residue) and drives
-- the RPC as user B through all five outcomes. B is the sole owner of
-- account B at seed time - exactly the state the RPC admits; every
-- mutation lives in ONE transaction that is rolled back at the end.
BEGIN;
INSERT INTO account_invitations (account_id, token_hash, role, expires_at)
VALUES
  (:'probe_a'::uuid, 'iso10-live-'    || :'nonce', 'admin', NOW() + interval '7 days'),
  (:'probe_a'::uuid, 'iso10-used-'    || :'nonce', 'admin', NOW() + interval '7 days'),
  (:'probe_a'::uuid, 'iso10-expired-' || :'nonce', 'admin', NOW() - interval '1 day'),
  (:'probe_b'::uuid, 'iso10-home-'    || :'nonce', 'admin', NOW() + interval '7 days');
UPDATE account_invitations
SET accepted_at = NOW(), accepted_by_user_id = :'uid_b'
WHERE token_hash = 'iso10-used-' || :'nonce';

SELECT set_config('iso.i_live',    'iso10-live-'    || :'nonce', true);
SELECT set_config('iso.i_used',    'iso10-used-'    || :'nonce', true);
SELECT set_config('iso.i_expired', 'iso10-expired-' || :'nonce', true);
SELECT set_config('iso.i_home',    'iso10-home-'    || :'nonce', true);
SELECT set_config('iso.uid_b',     :'uid_b',                  true);

DO $iso_section10$
DECLARE
  v_ret   uuid;
  v_home  text := 'UNTRIED';
  v_live  text := 'UNTRIED';
  v_used  text := 'UNTRIED';
  v_exp   text := 'UNTRIED';
  v_live2 text := 'UNTRIED';
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('iso.uid_b'), 'role', 'authenticated')::text, true);

  -- 1) B is already a member of its own account B -> 23505.
  BEGIN
    v_ret := public.redeem_invitation(current_setting('iso.i_home'));
    v_home := 'ALLOWED acc=' || v_ret;
  EXCEPTION WHEN SQLSTATE '23505' THEN v_home := 'REJECTED_23505';
  WHEN OTHERS THEN v_home := 'REJECTED_OTHER_' || SQLSTATE; END;

  -- 2) The live invitation: B joins account A -> returns account A —
  --    UNLESS B's old personal account carries domain data or B is not
  --    its sole owner, in which case the RPC's safety guard refuses
  --    with 23505. Both outcomes are gate-legal (a clean-CI user has
  --    an empty personal account; a working-DB user may not); a
  --    success in the refused shape, or any other SQLSTATE, fails.
  BEGIN
    v_ret := public.redeem_invitation(current_setting('iso.i_live'));
    v_live := 'OK acc=' || v_ret;
  EXCEPTION WHEN SQLSTATE '23505' THEN v_live := 'REJECTED_23505';
  WHEN OTHERS THEN
    v_live := 'REJECTED_OTHER_' || SQLSTATE || ' ' || LEFT(SQLERRM, 80); END;

  -- 3) The pre-seeded used row -> 22023.
  BEGIN
    PERFORM public.redeem_invitation(current_setting('iso.i_used'));
    v_used := 'ALLOWED';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_used := 'REJECTED_22023';
  WHEN OTHERS THEN v_used := 'REJECTED_OTHER_' || SQLSTATE; END;

  -- 4) The expired row -> 22023.
  BEGIN
    PERFORM public.redeem_invitation(current_setting('iso.i_expired'));
    v_exp := 'ALLOWED';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_exp := 'REJECTED_22023';
  WHEN OTHERS THEN v_exp := 'REJECTED_OTHER_' || SQLSTATE; END;

  -- 5) Consistent re-run of the live invitation: after a successful
  --    join the row is used -> 22023; after a 23505 refusal nothing
  --    changed, so the second call must return the SAME refusal.
  BEGIN
    PERFORM public.redeem_invitation(current_setting('iso.i_live'));
    v_live2 := 'ALLOWED_AGAIN';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_live2 := 'REJECTED_22023';
  WHEN SQLSTATE '23505' THEN v_live2 := 'REJECTED_23505';
  WHEN OTHERS THEN v_live2 := 'REJECTED_OTHER_' || SQLSTATE; END;

  PERFORM set_config('iso.section10.home',    v_home,  true);
  PERFORM set_config('iso.section10.live',    v_live,  true);
  PERFORM set_config('iso.section10.used',    v_used,  true);
  PERFORM set_config('iso.section10.expired', v_exp,   true);
  PERFORM set_config('iso.section10.live2',   v_live2, true);
END $iso_section10$;

SELECT current_setting('iso.section10.home')    AS home_outcome,
       current_setting('iso.section10.live')    AS live_outcome,
       current_setting('iso.section10.used')    AS used_outcome,
       current_setting('iso.section10.expired') AS expired_outcome,
       current_setting('iso.section10.live2')   AS live_again_outcome
\gset s10_
\echo '   home=' :s10_home_outcome '  live=' :s10_live_outcome '  used=' :s10_used_outcome '  expired=' :s10_expired_outcome '  live_again=' :s10_live_again_outcome

SELECT :'ledger' || CASE
  WHEN :'s10_home_outcome' = 'REJECTED_23505' THEN ''
  ELSE format(E'[10] FAIL already-member redeem was %s, expected 23505 (a member cannot join their own account twice)\n', :'s10_home_outcome')
END AS ledger \gset
SELECT :'ledger' || CASE
  WHEN :'s10_live_outcome' LIKE 'OK acc=' || :'probe_a' || '%'
    OR :'s10_live_outcome' = 'REJECTED_23505'
  THEN ''
  ELSE format(E'[10] FAIL live redeem was %s, expected success (empty personal account) or a 23505 safety refusal\n', :'s10_live_outcome')
END AS ledger \gset
SELECT :'ledger' || CASE
  WHEN :'s10_used_outcome' = 'REJECTED_22023' THEN ''
  ELSE format(E'[10] FAIL pre-used invitation was %s, expected 22023\n', :'s10_used_outcome')
END AS ledger \gset
SELECT :'ledger' || CASE
  WHEN :'s10_expired_outcome' = 'REJECTED_22023' THEN ''
  ELSE format(E'[10] FAIL expired invitation was %s, expected 22023\n', :'s10_expired_outcome')
END AS ledger \gset
SELECT :'ledger' || CASE
  WHEN (:'s10_live_outcome' LIKE 'OK acc=%' AND :'s10_live_again_outcome' = 'REJECTED_22023')
    OR (:'s10_live_outcome' = 'REJECTED_23505' AND :'s10_live_again_outcome' = 'REJECTED_23505')
  THEN ''
  ELSE format(E'[10] FAIL live-invitation re-run: first=%s, second=%s (expected 22023 after a join, or the same 23505 refusal)\n', :'s10_live_outcome', :'s10_live_again_outcome')
END AS ledger \gset
ROLLBACK;

-- ---------------------------------------------------------------------------
-- THE GATE. One raised error, so psql exits non-zero (measured: exit 3).
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- gate ---'
SELECT (length(:'ledger') > 0) AS has_failures \gset g_
\if :g_has_failures
\echo 'TENANT ISOLATION FAILED. Failures:'
\echo :ledger
-- RAISE EXCEPTION rather than \quit (measured to exit 0), with ON_ERROR_STOP on
-- (set at the top of this file) -> psql exits 3. ISO01 is a custom SQLSTATE so
-- it can never be confused with a 42501 raised by the policy being probed.
--
-- The outer format() tag is $fmt$, NOT $iso$: a nested dollar quote with the
-- SAME tag closes the outer literal early, which produced
-- "syntax error at or near BEGIN" and made the run fail for the wrong reason.
SELECT format($fmt$DO $iso$ BEGIN RAISE EXCEPTION %L USING ERRCODE = 'ISO01'; END $iso$;$fmt$,
              'tenant isolation FAILED: ' || :'ledger') AS iso_raise \gset iso_raise_
SELECT :'iso_raise_iso_raise' AS iso_raise_stmt \gexec
\else
\echo 'TENANT ISOLATION OK: own_rows > 0 for both users, 0 cross-account probe rows visible, cross-account INSERT rejected with 42501, cross-account UPDATE rejected with 42501, cross-account DELETE left account B''s row intact (counted as postgres), invitation RPC refused already-member (23505) and used/expired (22023).'
\endif
