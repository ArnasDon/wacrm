-- Monday 13:10 UTC (07:10 America/Guatemala) weekly health email
-- (src/app/api/admin/weekly-health/cron). Staggered after the 13:00
-- subscriptions job, whose secret the route falls back to.
--
-- SECRETS ARE NOT COMMITTED: apply with the two :'...' tokens replaced by
-- literals (same as 092), passing SUBSCRIPTIONS_CRON_SECRET.
SELECT cron.unschedule('weekly-health-email')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-health-email');

SELECT cron.schedule(
  'weekly-health-email',
  '10 13 * * 1',
  format(
    $f$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$f$,
    :'base_url' || '/api/admin/weekly-health/cron',
    :'cron_secret'
  )
);
