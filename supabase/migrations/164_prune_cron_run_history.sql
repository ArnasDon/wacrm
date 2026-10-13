-- pg_cron keeps one cron.job_run_details row per run forever. With 13 jobs
-- (several every 5 min) it reached 111k rows / 53 MB — over half the DB.
-- Keep 7 days, enough to debug a failed run.
SELECT cron.unschedule('prune-cron-run-history')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-cron-run-history');

SELECT cron.schedule(
  'prune-cron-run-history',
  '40 9 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);
