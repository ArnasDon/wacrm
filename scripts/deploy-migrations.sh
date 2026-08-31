#!/usr/bin/env bash
# ============================================================
# Apply supabase/migrations/*.sql to a Supabase Cloud project.
#
# Uses the official Supabase CLI (via npx — no global install, no
# Docker needed on this box) so migration state is tracked the same
# way `supabase db push` always tracks it (the
# supabase_migrations.schema_migrations table on the target
# database), making repeat runs a no-op for already-applied files.
#
# Usage:
#   SUPABASE_PROJECT_REF=abcdefghijklmnopqrst \
#   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx \
#   ./scripts/deploy-migrations.sh
#
# Where to find each value:
#   SUPABASE_PROJECT_REF   — Project Settings → General → Reference ID
#                             (also the subdomain in your project URL:
#                             https://<ref>.supabase.co)
#   SUPABASE_ACCESS_TOKEN  — https://supabase.com/dashboard/account/tokens
#                             (personal access token, not the anon/service
#                             key — this authenticates the CLI, not the app)
#
# Optional:
#   SUPABASE_DB_PASSWORD   — your project's Postgres password (Project
#                             Settings → Database). Only needed if the
#                             CLI can't link non-interactively without
#                             it — set it to avoid a password prompt in
#                             CI. Never required by the app itself.
#
# Safe to re-run any time you add a new file under supabase/migrations —
# already-applied migrations are skipped.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pinned so a future major-version CLI change doesn't silently alter
# migration behaviour on this script. Bump deliberately after testing.
SUPABASE_CLI_VERSION="2.111.0"

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "Error: SUPABASE_PROJECT_REF is required." >&2
  echo "Find it in Project Settings -> General -> Reference ID." >&2
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Error: SUPABASE_ACCESS_TOKEN is required." >&2
  echo "Create one at https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi
export SUPABASE_ACCESS_TOKEN

PW_FLAG=()
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  PW_FLAG=(-p "$SUPABASE_DB_PASSWORD")
fi

SUPABASE="npx -y supabase@${SUPABASE_CLI_VERSION}"

cd "$REPO_ROOT"

if [[ ! -d "supabase/migrations" ]]; then
  echo "Error: supabase/migrations not found under $REPO_ROOT" >&2
  exit 1
fi

migration_count=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
echo "==> Linking to Supabase project $SUPABASE_PROJECT_REF ($migration_count migration file(s) found locally)..."
$SUPABASE link --project-ref "$SUPABASE_PROJECT_REF" "${PW_FLAG[@]}"

echo "==> Pushing pending migrations..."
$SUPABASE db push --linked "${PW_FLAG[@]}"

echo "==> Current migration status on the linked project:"
$SUPABASE migration list --linked "${PW_FLAG[@]}"

echo "==> Done."
