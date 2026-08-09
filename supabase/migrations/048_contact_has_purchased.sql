-- ============================================================
-- 048_contact_has_purchased.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Foundation for commercial history on contacts: a single "Já comprou
-- comigo?" flag (Sim/Não), independent of tags, deals, or any
-- ownership/negotiation detail. Defaults to false so every existing
-- contact starts as "Não" without touching tags or other data.
-- Nullable is avoided on purpose — the field always has a defined
-- Sim/Não value, matching the two-state requirement.
--
-- `suggested_has_purchased` is unused today. It's reserved so a future
-- AI suggestion can propose a value without overwriting the
-- user-confirmed `has_purchased` field.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS has_purchased BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_has_purchased BOOLEAN;
