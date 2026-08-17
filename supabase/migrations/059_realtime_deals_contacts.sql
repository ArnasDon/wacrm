-- ============================================================
-- 059_realtime_deals_contacts.sql
--
-- The Pipelines page (sales board + the new customer-temperature
-- board) only ever fetched `deals`/`contacts` once on load — an AI
-- action changing a deal's stage or a contact's temperature in the
-- background (autoMoveDealStage / autoSetLeadTemperature,
-- src/lib/ai/auto-reply.ts) never showed up until the page was
-- manually refreshed, even though the database write itself lands
-- within a few seconds of the customer's message. Adds both tables to
-- the same `supabase_realtime` publication `conversations`/`messages`
-- already use (src/hooks/use-realtime.ts) so the client can subscribe
-- to live changes — RLS already scopes what a subscriber receives to
-- their own account, same as any other read.
--
-- `ALTER PUBLICATION ... ADD TABLE` has no `IF NOT EXISTS` — wrapped in
-- a DO block that swallows the "already a member" error so this stays
-- safe to re-run.
-- ============================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
