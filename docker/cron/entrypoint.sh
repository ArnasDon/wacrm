#!/bin/sh
set -eu
: "${CRON_SCHEDULE:=*/5 * * * *}"
mkdir -p /var/run/cron
date +%s > /var/run/cron/last-run
# Render the crontab with the schedule and install it for root.
mkdir -p /etc/crontabs
sed "s|@SCHEDULE@|${CRON_SCHEDULE}|" /etc/cron-template > /etc/crontabs/root
exec crond -f -l 8
