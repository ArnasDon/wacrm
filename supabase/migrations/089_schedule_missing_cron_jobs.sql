-- ============================================================
-- Register the background jobs that had NO scheduler.
--
-- Audit 2026-08-27: cron.job held only webhook-retry-sweep,
-- conversation-reassign-sweep and subscriptions-alert-sweep. The
-- automations "Wait" drain, the flows timeout sweep and the
-- heartbeat staleness watchdog were never being triggered in
-- production — automation Wait steps and flow timeouts silently
-- never fired.
--
-- Same shape as the existing jobs (`select * from cron.job`):
-- pg_net GET + `x-cron-secret` header, 8s timeout.
--   - automations + flows authenticate with AUTOMATION_CRON_SECRET
--     (one secret, by design — see src/app/api/flows/cron/route.ts)
--   - heartbeat-check accepts HEALTHCHECK_CRON_SECRET or, failing
--     that, WEBHOOK_CRON_SECRET
--
-- SECRETS ARE NOT COMMITTED. Like the three pre-existing jobs, the
-- live schedule is applied directly in the Supabase SQL editor with
-- the real values. Run this with psql vars, e.g.:
--
--   psql "$DATABASE_URL" \
--     -v base_url="https://your-app.example" \
--     -v automation_secret="$AUTOMATION_CRON_SECRET" \
--     -v healthcheck_secret="$WEBHOOK_CRON_SECRET" \
--     -f supabase/migrations/089_schedule_missing_cron_jobs.sql
--
-- ...or paste it into the SQL editor with the three :'...' tokens
-- replaced by literals.
--
-- Prereq: AUTOMATION_CRON_SECRET must also be set in the app env
-- (EasyPanel) or the two jobs get 503 "cron not configured".
--
-- Idempotent: unschedule-then-schedule, safe to re-run.
-- ============================================================

\if :{?base_url}
\else
  \set base_url 'https://REPLACE_ME.example'
\endif
\if :{?automation_secret}
\else
  \set automation_secret 'REPLACE_ME_AUTOMATION_CRON_SECRET'
\endif
\if :{?healthcheck_secret}
\else
  \set healthcheck_secret 'REPLACE_ME_WEBHOOK_CRON_SECRET'
\endif

do $$ begin perform cron.unschedule('automations-pending-drain'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('flows-timeout-sweep');       exception when others then null; end $$;
do $$ begin perform cron.unschedule('heartbeat-staleness-check');  exception when others then null; end $$;

select cron.schedule(
  'automations-pending-drain',
  '*/5 * * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/automations/cron', :'automation_secret'
  )
);

select cron.schedule(
  'flows-timeout-sweep',
  '*/5 * * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/flows/cron', :'automation_secret'
  )
);

select cron.schedule(
  'heartbeat-staleness-check',
  '*/5 * * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/system/heartbeat-check/cron', :'healthcheck_secret'
  )
);
