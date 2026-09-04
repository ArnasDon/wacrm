-- ============================================================
-- 052_ai_usage_log_catalog_external_observability
--
-- AI optimization project — FASE 12 (Observabilidad real).
--
-- ai_usage_log already knows a catalog tool was attached/used
-- (migration 049: catalog_attached/catalog_used), but has no way to
-- tell WHICH provider actually answered — internal (Sheet/CSV) or
-- Budun (external, rate-limited via RATE_LIMITS.catalogExternalAccount,
-- FASE 7). Without this, "cuántas llamadas Budun realiza cada cuenta"
-- and "cuántas son bloqueadas" — the exact question FASE 12 was asked
-- to make answerable — cannot be reconstructed from existing columns
-- no matter how they're combined.
--
-- Purely additive: two new NULLABLE boolean columns, no default. NULL
-- means "not computed by this call site" (every row logged before this
-- migration, and any row from a caller that never engages catalog at
-- all) — never coerced to `false`, matching every other breakdown
-- column's "NULL vs. confirmed-negative" discipline (migration 049).
-- catalog_external_used and catalog_external_blocked are NOT mutually
-- exclusive: a single search_all_active fan-out across two configured
-- Budun integrations could have one blocked (budget exhausted) and one
-- still within budget in the very same call — see
-- src/lib/ai/catalog/resolver.ts's `externalUsed`/`externalLimitReached`
-- doc for the underlying (already-existing, unmodified) fields these
-- are derived from. No existing column, index, or RLS policy is
-- touched.
-- ============================================================

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS catalog_external_used boolean,
  ADD COLUMN IF NOT EXISTS catalog_external_blocked boolean;

COMMENT ON COLUMN ai_usage_log.catalog_external_used IS
  'At least one Budun-backed (external) catalog provider was actually invoked this call — the external-call budget allowed it. NULL when not computed (no catalog tool call this turn, or the caller predates this column).';

COMMENT ON COLUMN ai_usage_log.catalog_external_blocked IS
  'At least one catalog tool call this turn was blocked by the external-call budget (RATE_LIMITS.catalogExternalAccount) and returned external_limit_reached instead of running. NULL when not computed.';
