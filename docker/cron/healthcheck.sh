#!/bin/sh
pgrep crond >/dev/null || exit 1
last="$(cat /var/run/cron/last-run 2>/dev/null)" || exit 1
now="$(date +%s)"
[ $((now - last)) -lt "${CRON_HEARTBEAT_MAX_AGE:-900}" ]
