-- ============================================================
-- 050_rimula_member_fields.sql — extend `contacts` into `Member`
-- (§9.0, §9.1)
--
-- §9.1's Member field set: role, region, market, vehicle,
-- vehicleType, optInStatus, whatsappStatus, communityStatus,
-- joinedDate, lastEngagement. `region`/`market` land as FKs into the
-- `regions`/`markets` lookup tables added in migration 049 (see that
-- file's header for why) rather than free text.
--
-- No new RLS policies: `contacts_select/insert/update/delete`
-- (migration 017) are already row-level, not column-level, so they
-- cover every column added here automatically. No new table, so no
-- new `account_id`/RLS requirement to satisfy — this migration only
-- widens an existing account-scoped table.
--
-- `role` reuses §8's community audience roles exactly (Mechanic,
-- Truck Driver, Truck Owner, BA, Other) — a BA can also be enrolled
-- as a community member, which is why 'BA' is a valid Member role
-- distinct from the `profiles.account_role` permission enum.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IN ('Mechanic', 'Truck Driver', 'Truck Owner', 'BA', 'Other')),
  ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id) ON DELETE SET NULL,
  -- Self-reported vehicle description/model and its broad type. Plain
  -- text, deliberately NOT a FK into the Phase 1 `vehicles` catalog
  -- (migration 042) — that table holds admin-verified compatibility
  -- data; this is just what the Member told us about their own
  -- vehicle, which the catalog has no obligation to already contain.
  ADD COLUMN IF NOT EXISTS vehicle TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS opt_in_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (opt_in_status IN ('opted_in', 'opted_out', 'pending')),
  -- Drives the §19 "WhatsApp confirmed" seed/dashboard metric.
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (whatsapp_status IN ('confirmed', 'unconfirmed', 'invalid')),
  ADD COLUMN IF NOT EXISTS community_status TEXT NOT NULL DEFAULT 'active'
    CHECK (community_status IN ('active', 'inactive')),
  ADD COLUMN IF NOT EXISTS last_engagement TIMESTAMPTZ;

-- joined_date gets a real backfill (from `created_at`) rather than a
-- single evaluate-once-at-migration-time default, so pre-existing
-- contacts don't all show today's date as when they "joined" — that
-- would misrepresent real history, which §2's data-integrity rule
-- also cares about. Two-step, same idiom migration 017 used to widen
-- account_id to NOT NULL after backfilling it.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS joined_date DATE;
UPDATE contacts SET joined_date = created_at::date WHERE joined_date IS NULL;
ALTER TABLE contacts ALTER COLUMN joined_date SET DEFAULT CURRENT_DATE;
ALTER TABLE contacts ALTER COLUMN joined_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_account_role ON contacts(account_id, role);
CREATE INDEX IF NOT EXISTS idx_contacts_region ON contacts(region_id);
CREATE INDEX IF NOT EXISTS idx_contacts_market ON contacts(market_id);
CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_status ON contacts(account_id, whatsapp_status);
