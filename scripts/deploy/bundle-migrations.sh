#!/usr/bin/env bash
#
# Bundle the ads-attribution migrations into one file to paste into the
# Supabase Cloud SQL editor.
#
# The self-hosted setup has no migration runner, so production schema
# changes are applied by hand. Generating the bundle instead of
# maintaining a second copy of the SQL means it cannot drift from
# supabase/migrations/, which is what `db reset` actually verifies.
#
# Usage: ./scripts/deploy/bundle-migrations.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

MIGRATIONS=(037 038 039 040 041 042)
OUT=docs/deploy/ads-attribution.sql

mkdir -p "$(dirname "$OUT")"

{
  cat <<'HEADER'
-- ============================================================
-- wacrm — ads attribution, ROI and salesperson assignment
-- Migrations 037 through 042, in order.
--
-- GENERATED FILE — do not edit. Regenerate with:
--   ./scripts/deploy/bundle-migrations.sh
--
-- HOW TO APPLY
--   1. Supabase Cloud -> SQL Editor -> New query.
--   2. Paste this whole file and run it.
--   3. THEN deploy the new app code (merge to main + redeploy).
--
-- Order matters, and this way round is the safe one: every change here
-- is additive (new tables, new columns with defaults), so the code
-- currently running in production keeps working against the new schema.
-- Deploying first would instead point the new code at tables that do
-- not exist yet.
--
-- Safe to re-run: tables use CREATE TABLE IF NOT EXISTS, columns use
-- ADD COLUMN IF NOT EXISTS, constraints and policies are dropped before
-- being recreated, and functions use CREATE OR REPLACE.
--
-- One statement is not purely additive: 037 drops the 4-argument
-- filter_contacts_by_tags so it can be recreated with a 5th, defaulted
-- parameter. That is safe during the window before the redeploy,
-- because the app calls this function with *named* parameters and the
-- new p_source defaults to NULL — the old 4-argument calls still
-- resolve.
-- ============================================================

HEADER

  for m in "${MIGRATIONS[@]}"; do
    file=$(ls supabase/migrations/"${m}"_*.sql)
    echo ""
    echo "-- ############################################################"
    echo "-- ##  $(basename "$file")"
    echo "-- ############################################################"
    echo ""
    cat "$file"
  done
} > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
