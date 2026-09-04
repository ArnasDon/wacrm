-- ============================================================
-- RLS test suite — LOCAL-ONLY CI privilege bootstrap.
--
-- This file is NOT a migration. It is never applied to the hosted
-- Supabase project, never referenced by `supabase/migrations/`, and
-- lives here — unambiguously inside the test suite it serves — on
-- purpose.
--
-- WHY THIS EXISTS: Supabase's hosted platform grants baseline table
-- privileges (SELECT/INSERT/UPDATE/DELETE) to `anon`/`authenticated`/
-- `service_role` automatically when a project is created — a
-- platform-level `ALTER DEFAULT PRIVILEGES` this project's own
-- migrations never had to declare, and never should (it's a property
-- of the hosted project, not of this schema — confirmed by reading
-- every one of the 57 migrations: none of them ever GRANTs a baseline
-- table privilege to any role; the one table-level GRANT/REVOKE that
-- does exist, in 027_notifications.sql, explicitly NARROWS an assumed
-- pre-existing broader privilege to a single column — it does not
-- establish one).
--
-- A freshly-provisioned LOCAL Supabase stack (`supabase start` +
-- `supabase db reset --local`, exactly what `.github/workflows/
-- rls.yml` does) does not replicate that hosted-platform bootstrap.
-- Confirmed directly by this workflow's own CI diagnostics: RLS was
-- correctly enabled, `service_role` correctly had BYPASSRLS, and yet
-- `has_table_privilege('service_role', 'public.accounts', 'SELECT')`
-- was `false` — a coarser, pre-RLS privilege check that BYPASSRLS
-- does not affect.
--
-- Grants EXACTLY the privileges this suite's own fixtures
-- (fixtures.ts) and assertions (*.rls.test.ts) exercise — the 12
-- tables this suite touches, nothing else:
--   - `service_role` needs them to seed/tear down fixtures
--     (tests/rls/fixtures.ts — every INSERT/SELECT/DELETE there).
--   - `authenticated` needs the SAME baseline (mirroring what the
--     hosted platform already gives it) so that the RLS assertions,
--     made through real signed-in fixture users
--     (signInAsFixtureUser()), actually reach the RLS policy layer
--     under test instead of failing earlier at this coarser
--     privilege check — without this, the suite would not be testing
--     RLS at all, it would just be re-proving this same missing-grant
--     issue against `authenticated` instead of `service_role`.
--   - `anon` receives nothing: no test in this suite ever queries a
--     table as `anon`.
--
-- Never touches RLS policies, table ownership, or any other part of
-- the schema — only this one, missing, pre-RLS privilege layer, and
-- only inside a disposable local CI database.
-- ============================================================

-- Punto 9, H9-1 — tests/rls/notifications.rls.test.ts (new) is the
-- first test in this suite to touch `public.notifications` at all, via
-- service_role fixture-style inserts — same missing-baseline-privilege
-- gap as every table below, now surfaced for this one.
--
-- UPDATE on notifications is granted to service_role only, NOT blanket
-- to `authenticated` like the tables below: migration 027 deliberately
-- narrows `authenticated`'s UPDATE on this table to the `read_at`
-- column alone (`REVOKE UPDATE ... FROM authenticated; GRANT UPDATE
-- (read_at) ... TO authenticated;`), applied during "Replay every
-- migration from scratch" — which runs BEFORE this file. A blanket
-- `GRANT UPDATE ON TABLE ... TO authenticated` here would silently
-- re-widen that back to every column for the rest of the local CI run,
-- which is exactly the kind of real-security change this file must
-- never make (see this file's own header). SELECT/INSERT/DELETE carry
-- no such column-level narrowing for `authenticated` — safe to mirror
-- the same baseline pattern as every other table (RLS still gates
-- every actual row: this table's own policies grant `authenticated`
-- no INSERT/DELETE policy at all, and SELECT/UPDATE both require
-- auth.uid() = user_id AND is_account_member(account_id), migrations
-- 027/062).
--
-- Wrapped in a single DO block, rather than separate top-level GRANT
-- statements, because `supabase db query --file` (how this file is
-- executed — see .github/workflows/rls.yml) sends the whole file as
-- ONE prepared statement: a second top-level statement fails with
-- "cannot insert multiple commands into a prepared statement" — the
-- exact same constraint supabase/ci/verify-schema.sql's own header
-- already documents for the identical mechanism. GRANT is DDL, so each
-- one runs via EXECUTE inside the block (PL/pgSQL cannot call it
-- directly); the block itself is still exactly one top-level statement
-- from the file's point of view.
DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE '
    || 'public.accounts, public.profiles, public.contacts, public.conversations, '
    || 'public.ai_data_sources, public.ai_catalog_products, public.ai_knowledge_documents, '
    || 'public.ai_knowledge_chunks, public.account_business_profiles, '
    || 'public.account_business_departments, public.account_business_contacts, '
    || 'public.ai_configs TO service_role, authenticated';

  EXECUTE 'GRANT SELECT, INSERT, DELETE ON TABLE public.notifications TO service_role, authenticated';
  EXECUTE 'GRANT UPDATE ON TABLE public.notifications TO service_role';
END $$;
