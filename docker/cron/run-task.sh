#!/bin/sh
# Usage: run-task.sh <path>  — GET $APP_URL<path> with the cron secret.
path="$1"
out="$(mktemp)"
code="$(curl -sS -m 60 -o "$out" -w '%{http_code}' \
  -H "x-cron-secret: ${AUTOMATION_CRON_SECRET:-}" \
  "${APP_URL}${path}" 2>&1)" || code="000"
echo "${path} ${code}"
head -c 500 "$out" 2>/dev/null; echo
rm -f "$out"
case "$code" in
  2??) date +%s > /var/run/cron/last-run; exit 0 ;;
  *) exit 1 ;;
esac
