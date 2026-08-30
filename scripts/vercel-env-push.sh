#!/usr/bin/env bash
#
# Push a local env file into a Vercel environment.
#
#   ./scripts/vercel-env-push.sh [env-file] [target]
#   ./scripts/vercel-env-push.sh .env.production production   # defaults
#
# Existing values are overwritten (--force), so this is idempotent.
#
# Why the two code paths: Vercel refuses "sensitive" visibility for
# variables with a public framework prefix (NEXT_PUBLIC_*) on Production
# and Preview — they end up in the client bundle anyway, so they have to
# be stored as readable config. Everything else goes in sensitive.
#
# Note: NEXT_PUBLIC_* values are inlined at build time. Changing one here
# has no effect until the next deploy.
set -euo pipefail

FILE="${1:-.env.production}"
TARGET="${2:-production}"

[ -f "$FILE" ] || { echo "no such env file: $FILE" >&2; exit 1; }

pushed=0
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  [ "${line#*=}" = "$line" ] && continue

  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in *[!A-Za-z0-9_]*) continue ;; esac   # skip anything that isn't a bare key
  [ -n "$value" ] || continue                        # skip declared-but-empty

  # Strip one layer of surrounding quotes, if present.
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac

  if [ "${key#NEXT_PUBLIC_}" != "$key" ]; then
    flags=(--visibility config --no-sensitive)
  else
    flags=()
  fi

  # bash 3.2 (macOS) errors on "${flags[@]}" for an empty array under
  # `set -u`, hence the +expansion guard.
  if printf '%s' "$value" | vercel env add "$key" "$TARGET" --force ${flags[@]+"${flags[@]}"} >/dev/null 2>&1; then
    echo "  ok      $key"
    pushed=$((pushed + 1))
  else
    echo "  FAILED  $key" >&2
  fi
done < "$FILE"

echo "pushed $pushed variable(s) from $FILE to $TARGET"
