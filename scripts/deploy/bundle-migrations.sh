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
# Usage:
#   ./scripts/deploy/bundle-migrations.sh                       # ads release (default)
#   ./scripts/deploy/bundle-migrations.sh docs/deploy/x.sql 043 # any other set
#
# One file per release, never a combined one: the bundles are pasted by
# hand into the Supabase SQL editor, and "which of these do I still
# have to run?" is exactly the question a merged file makes impossible
# to answer.
set -euo pipefail

cd "$(dirname "$0")/../.."

OUT=${1:-docs/deploy/ads-attribution.sql}
shift || true
MIGRATIONS=("$@")
if [ ${#MIGRATIONS[@]} -eq 0 ]; then
  # No arguments: the ads release, kept as the default so the existing
  # `bundle-migrations.sh` in the runbook keeps producing the same file.
  MIGRATIONS=(037 038 039 040 041 042)
  : "${TITLE:=ads attribution, ROI and salesperson assignment}"
fi
# Override with TITLE=... to name a release; otherwise the filename is
# a decent stand-in, and better than a generic banner that makes two
# bundles look interchangeable when they are not.
: "${TITLE:=$(basename "$OUT" .sql)}"
SANITIZE="$(dirname "$0")/sanitize-comments.py"

mkdir -p "$(dirname "$OUT")"

FIRST=${MIGRATIONS[0]}
LAST=${MIGRATIONS[${#MIGRATIONS[@]} - 1]}
if [ "$FIRST" = "$LAST" ]; then
  RANGE="Migration $FIRST."
else
  RANGE="Migrations $FIRST through $LAST, in order."
fi

{
  # The dynamic lines are echoed rather than interpolated into the
  # heredoc below, which stays quoted on purpose: its body contains
  # backticks, and an unquoted heredoc would run them as commands.
  echo "-- ============================================================"
  echo "-- wacrm — $TITLE"
  echo "-- $RANGE"
  echo "--"
  echo "-- GENERATED FILE — do not edit. Regenerate with:"
  echo "--   ./scripts/deploy/bundle-migrations.sh $OUT ${MIGRATIONS[*]}"

  cat <<'HEADER'
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
-- IF THE EDITOR STILL REPORTS A SYNTAX ERROR
--   It is splitting the script into statements and getting it wrong, not
--   objecting to the SQL. Run the file one section at a time: each
--   `-- ####` banner below starts a migration, and they are independent
--   in that order. The apostrophes in comments that caused this once
--   already are rewritten by the generator (see sanitize-comments.py).
HEADER

  # Only true of the ads release, so it is emitted only when 037 is in
  # the set — a caveat printed over a bundle it does not apply to is
  # worse than no caveat, because it sends the reader looking for a
  # statement that is not there.
  if printf '%s\n' "${MIGRATIONS[@]}" | grep -qx 037; then
    cat <<'CAVEAT'
--
-- One statement is not purely additive: 037 drops the 4-argument
-- filter_contacts_by_tags so it can be recreated with a 5th, defaulted
-- parameter. That is safe during the window before the redeploy,
-- because the app calls this function with *named* parameters and the
-- new p_source defaults to NULL — the old 4-argument calls still
-- resolve.
CAVEAT
  fi

  echo "-- ============================================================"
  echo ""

  for m in "${MIGRATIONS[@]}"; do
    file=$(ls supabase/migrations/"${m}"_*.sql)
    echo ""
    echo "-- ############################################################"
    echo "-- ##  $(basename "$file")"
    echo "-- ############################################################"
    echo ""
    cat "$file"
  done
# Apostrophes in `--` comments are legal SQL but break the Supabase SQL
# Editor's client-side statement splitter — see sanitize-comments.py.
} | python3 "$SANITIZE" > "$OUT"

remaining=$(grep -c "^[[:space:]]*--.*'" "$OUT" || true)
if [ "$remaining" -ne 0 ]; then
  echo "WARNING: $remaining comment line(s) still contain an apostrophe" >&2
fi

echo "Wrote $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
