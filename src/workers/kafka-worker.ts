/**
 * Standalone Kafka worker — `npm run worker:kafka`.
 *
 * Runs the consumers (webhook events, campaign sends, template status)
 * and the campaign scheduler without the web app, so they can be scaled
 * separately (e.g. an ECS service next to MSK). Run as many as you like:
 * campaign.sends partitions are shared across the consumer group, and
 * recipient claims keep a redelivered message from sending twice.
 *
 * Reads .env.local when present; in containers pass env vars directly.
 * WORKER_SCHEDULER=off skips the scheduler (if the app already runs it).
 * REDIS_URL shares each WhatsApp number's speed limit across all workers.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local — environment comes from the container / shell
}

async function main() {
  const { installProcessGuards } = await import('@/lib/process-guards');
  installProcessGuards('kafka-worker');
  // Label this process in the campaign speed log.
  const { setProcessRole } = await import('@/lib/process-metrics');
  setProcessRole('kafka-worker');
  const { kafkaEnabled } = await import('@/lib/kafka/config');
  if (!kafkaEnabled()) {
    console.error('KAFKA_BROKERS is not set — nothing to consume.');
    process.exit(1);
  }
  const { redisEnabled, closeRedis } = await import('@/lib/redis/client');
  console.info(
    redisEnabled()
      ? '[kafka-worker] Redis: on — speed limits shared per WhatsApp number across workers'
      : '[kafka-worker] Redis: off (REDIS_URL not set) — speed limits per worker process'
  );
  const { startKafkaWorkers } = await import('@/lib/kafka/consumers');
  const handle = await startKafkaWorkers();

  if (process.env.WORKER_SCHEDULER !== 'off') {
    const { startCampaignScheduler } =
      await import('@/lib/campaigns/scheduler-loop');
    startCampaignScheduler();
  }

  // Daily data retention; the database lease makes it run once per UTC
  // day however many workers and app servers are up.
  const { startRetentionScheduler } =
    await import('@/lib/maintenance/scheduler');
  startRetentionScheduler();

  const shutdown = async (signal: string) => {
    console.info(`[kafka-worker] ${signal} — stopping consumers`);
    await handle.stop();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[kafka-worker] fatal:', err);
  process.exit(1);
});

// Module scope (keeps `main` local to this file).
export {};
