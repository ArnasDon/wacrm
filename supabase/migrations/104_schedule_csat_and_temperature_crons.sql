-- ============================================================
-- 104_schedule_csat_and_temperature_crons.sql — register two sweeps
--
-- Same shape as 100_schedule_followups_cron.sql: pg_cron rows that
-- pg_net GET the sweep endpoints with the `x-cron-secret` header.
--
--   csat-sweep              every 15 min  -> /api/csat/cron
--   lead-temperature-sweep  hourly        -> /api/contacts/temperature-sweep/cron
--
-- Both endpoints authenticate with `AUTOMATION_CRON_SECRET` (the CSAT
-- one also accepts `CSAT_CRON_SECRET`, the temperature one
-- `TEMPERATURE_CRON_SECRET`), so you can reuse the secret already
-- provisioned for automations/flows/followups and set nothing new.
--
-- SECRETS ARE NOT COMMITTED — run this in the Supabase SQL editor with
-- the two :'...' tokens replaced by literals, or with psql vars:
--
--   psql "$DATABASE_URL" \
--     -v base_url="https://your-app.example" \
--     -v cron_secret="$AUTOMATION_CRON_SECRET" \
--     -f supabase/migrations/104_schedule_csat_and_temperature_crons.sql
--
-- Prereq: the matching secret must also be set in the app env
-- (EasyPanel) or the endpoints return 503 "cron not configured".
-- Until these jobs are registered the `csat_cron` /
-- `temperature_sweep_cron` heartbeats read "never" and the watchdog
-- raises a (warning-level) "has never reported" alert — expected.
--
-- Idempotent: unschedule-then-schedule, safe to re-run.
-- ============================================================

\if :{?base_url}
\else
  \set base_url 'https://REPLACE_ME.example'
\endif
\if :{?cron_secret}
\else
  \set cron_secret 'REPLACE_ME_AUTOMATION_CRON_SECRET'
\endif

do $$ begin perform cron.unschedule('csat-sweep'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('lead-temperature-sweep'); exception when others then null; end $$;

select cron.schedule(
  'csat-sweep',
  '*/15 * * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/csat/cron', :'cron_secret'
  )
);

select cron.schedule(
  'lead-temperature-sweep',
  '7 * * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/contacts/temperature-sweep/cron', :'cron_secret'
  )
);
