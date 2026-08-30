-- ============================================================
-- Schedule the data-retention sweep.
--
-- `run_data_retention()` (migration 080) + the orphaned-chat-media
-- prune have been built and idempotent since 2026-08-27 but were left
-- UNscheduled on purpose: the endpoint deletes rows when called with
-- `?execute=true` (without it, it only dry-runs), so a human had to
-- sign off on the retention windows first. Signed off 2026-08-29 —
-- keep the windows baked into `run_data_retention` as-is (30–180 days,
-- technical/operational history only; contacts, messages,
-- conversations, deals, quotes, broadcasts, products and
-- `ai_action_log` are never touched — see 080's own header).
--
-- Same shape as the other jobs (`select * from cron.job`): pg_net GET
-- + `x-cron-secret` header, 8s timeout. Runs once a day at 09:20 UTC
-- (~03:20 in America/Guatemala) — off-peak, staggered from the 5-min
-- sweeps and the 13:00 subscriptions job. Work is batched (1000
-- rows/table/run inside the route), so a first-time backlog just
-- trickles down over several days; nothing to tune.
--
-- SECRET: the route accepts `RETENTION_CRON_SECRET` and falls back to
-- `WEBHOOK_CRON_SECRET`. Easiest is to pass your existing
-- WEBHOOK_CRON_SECRET here — then there is nothing new to add in
-- EasyPanel. (Pass a dedicated RETENTION_CRON_SECRET instead only if
-- you also set that same value in the app env, or the job gets 503
-- "cron not configured".)
--
-- SECRETS ARE NOT COMMITTED. Like every other job, apply this in the
-- Supabase SQL editor with the two :'...' tokens replaced by literals,
-- or via psql:
--
--   psql "$DATABASE_URL" \
--     -v base_url="https://sandia-sandia-crm.kmencc.easypanel.host" \
--     -v retention_secret="$WEBHOOK_CRON_SECRET" \
--     -f supabase/migrations/092_schedule_data_retention_cron.sql
--
-- Idempotent: unschedule-then-schedule, safe to re-run.
-- ============================================================

\if :{?base_url}
\else
  \set base_url 'https://REPLACE_ME.example'
\endif
\if :{?retention_secret}
\else
  \set retention_secret 'REPLACE_ME_WEBHOOK_CRON_SECRET'
\endif

do $$ begin perform cron.unschedule('data-retention-sweep'); exception when others then null; end $$;

select cron.schedule(
  'data-retention-sweep',
  '20 9 * * *',
  format(
    $job$select net.http_get(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 8000);$job$,
    :'base_url' || '/api/maintenance/retention/cron?execute=true', :'retention_secret'
  )
);
