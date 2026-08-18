-- ============================================================
-- 051_rimula_ba_fields.sql — extend `profiles` into `BA` (§9.0, §9.1)
--
-- §9.1's BA field set: region, market, status, openLeads, capacity,
-- languages. `region`/`market` are FKs into migration 049's lookup
-- tables, same rationale as the Member fields in migration 050.
--
-- Column is named `ba_status`, not bare `status` — §9.0's note on
-- this exact table already warns that `profiles.role` (legacy) and
-- `profiles.account_role` (real permission enum) are easy to confuse
-- because they're both vaguely-named columns on a multi-purpose
-- table; adding a third bare `status` here would be the same mistake
-- a third time.
--
-- `languages` reuses the exact language codes migration 046's
-- `content_translations.language` CHECK uses (`ur`, `ps`, `pa`,
-- `ur-Roman`) rather than English words — §14 says a BA "may edit
-- ContentTranslation rows for languages in their own languages
-- field," which only works as a direct `translation.language =
-- ANY(profile.languages)` comparison if both sides speak the same
-- code, so they must match exactly.
--
-- `open_leads` is a denormalized counter, not a live COUNT(*) — it
-- starts at 0 for every profile and is maintained by the BA-routing
-- logic (§12, phase 6), which is what actually assigns/unassigns
-- leads. This migration only adds the column.
--
-- No new RLS policies: `profiles_select/update/insert` (migration
-- 017) already gate every column on this table (note:
-- `profiles_update` only allows a user to update their OWN row —
-- an admin setting a teammate's region/market/capacity therefore
-- needs a server-side endpoint using the service-role client, same
-- as account_role changes already go through `/api/account/members`
-- rather than direct client writes; building that endpoint is
-- explicitly out of scope for this migration).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ba_status TEXT NOT NULL DEFAULT 'active'
    CHECK (ba_status IN ('active', 'inactive', 'on_leave')),
  ADD COLUMN IF NOT EXISTS open_leads INTEGER NOT NULL DEFAULT 0
    CHECK (open_leads >= 0),
  ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 10
    CHECK (capacity >= 0),
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}'
    CHECK (languages <@ ARRAY['ur', 'ps', 'pa', 'ur-Roman']::text[]);

-- Partial indexes shaped for §12's routing hot path (`Market BA →
-- Regional BA → Unassigned`, cf. migration 020's precedent of
-- indexing WHERE the row is actually eligible for the dispatch path
-- rather than the whole table).
CREATE INDEX IF NOT EXISTS idx_profiles_market_active
  ON profiles(account_id, market_id) WHERE ba_status = 'active';
CREATE INDEX IF NOT EXISTS idx_profiles_region_active
  ON profiles(account_id, region_id) WHERE ba_status = 'active';
