-- ============================================================
-- 100_schedule_followups_cron.sql — register the follow-up sweep job
--
-- Same shape as 089_schedule_missing_cron_jobs.sql: a pg_net GET with
-- the `x-cron-secret` header, on a 5-minute schedule. The sweep
-- (/api/ai/followups/cron) authenticates with FOLLOWUPS_CRON_SECRET
-- and falls back to AUTOMATION_CRON_SECRET, so you can reuse the
-- secret already provisioned for the automations/flows jobs and set
-- nothing new.
--
-- SECRETS ARE NOT COMMITTED — run this in the Supabase SQL editor with
-- the two :'...' tokens replaced by literals, or with psql vars:
--
--   psql "$DATABASE_URL" \
--     -v base_url="https://your-app.example" \
--     -v cron_secret="$AUTOMATION_CRON_SECRET" \
--     -f supabase/migrations/100_schedule_followups_cron.sql
--
-- Prereq: FOLLOWUPS_CRON_SECRET (or AUTOMATION_CRON_SECRET) must also
-- be set in the app env (EasyPanel) or the endpoint returns 503
-- "cron not configured". Until this job is registered the
-- `followups_cron` heartbeat reads "never" and the heartbeat watchdog
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

do $$ begin perform cron.unschedule('ai-followups-sweep'); exception when others then null; end $$;

select cron.schedule(
  'ai-followups-sweep',
  '*/5 * * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/ai/followups/cron', :'cron_secret'
  )
);
