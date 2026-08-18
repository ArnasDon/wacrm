-- ============================================================
-- 040_rimula_community_groups.sql — Rimula community destinations
--
-- First net-new table for the Rimula Community Growth Platform (see
-- docs/RIMULA_BUILD_SPEC.md §9.0/§9.1, §8). §8 asks for one MVP
-- destination — "Rimula Announcements" — modeled as a generic
-- `CommunityGroup` so more destinations can be added later without a
-- schema change. This migration adds the table only; the MVP row
-- itself is created by the seed script (idempotent, re-runnable),
-- not baked into the migration.
--
-- Settings-class table (mirrors `tags` / `pipelines` from migration
-- 017): any account member may read; only admin+ may create, rename,
-- or archive a destination.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS community_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_groups_account ON community_groups(account_id);

ALTER TABLE community_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_groups_select ON community_groups;
CREATE POLICY community_groups_select ON community_groups FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS community_groups_insert ON community_groups;
CREATE POLICY community_groups_insert ON community_groups FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS community_groups_update ON community_groups;
CREATE POLICY community_groups_update ON community_groups FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS community_groups_delete ON community_groups;
CREATE POLICY community_groups_delete ON community_groups FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON community_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON community_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
