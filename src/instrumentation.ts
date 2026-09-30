/**
 * Runs once when a Next.js server instance starts.
 *
 * On a long-running Node server (`next start`, Docker, `next dev`) this
 * starts:
 *
 *   - the in-process advanced-campaign scheduler, so scheduled campaigns
 *     go out on time and an interrupted one resumes without any external
 *     cron (serverless hosts: point a cron at GET /api/campaigns/tick);
 *   - the Kafka consumers, when KAFKA_BROKERS is set and KAFKA_WORKERS
 *     isn't "off" (then run `npm run worker:kafka` separately instead);
 *   - the daily data-retention cleanup (serverless hosts: point a daily
 *     cron at GET /api/maintenance/retention).
 *
 * Set CAMPAIGN_SCHEDULER=off to disable the scheduler (e.g. when several
 * replicas run and only a cron should drive campaigns — the run lock
 * makes overlap safe either way).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.VERCEL) return;
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    return;

  // A bug in background work must not crash the web server.
  const { installProcessGuards } = await import('@/lib/process-guards');
  installProcessGuards('server');

  if (process.env.CAMPAIGN_SCHEDULER !== 'off') {
    const { startCampaignScheduler } =
      await import('@/lib/campaigns/scheduler-loop');
    startCampaignScheduler();
  }

  // Daily data retention (DATA_RETENTION_DAYS, default 15; "off"
  // disables): deletes data older than that except profiles/accounts.
  // Runs once per UTC day across all instances — see
  // src/lib/maintenance/retention.ts.
  const { startRetentionScheduler } =
    await import('@/lib/maintenance/scheduler');
  startRetentionScheduler();

  const { inProcessWorkers } = await import('@/lib/kafka/config');
  if (inProcessWorkers()) {
    const { startKafkaWorkers } = await import('@/lib/kafka/consumers');
    // Don't block server start on the cluster; retry in the background.
    const start = (delay: number) =>
      startKafkaWorkers().catch((err) => {
        console.error(
          '[kafka] workers failed to start, retrying:',
          err instanceof Error ? err.message : err
        );
        setTimeout(() => start(Math.min(delay * 2, 60_000)), delay);
      });
    void start(5_000);
  }
}
