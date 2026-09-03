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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.accounts,
  public.profiles,
  public.contacts,
  public.conversations,
  public.ai_data_sources,
  public.ai_catalog_products,
  public.ai_knowledge_documents,
  public.ai_knowledge_chunks,
  public.account_business_profiles,
  public.account_business_departments,
  public.account_business_contacts,
  public.ai_configs
TO service_role, authenticated;
