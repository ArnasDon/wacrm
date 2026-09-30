/**
 * Redis check — `npm run redis:check`.
 *
 * Verifies REDIS_URL works for the shared per-number speed limit:
 *   1. connects and PINGs;
 *   2. runs the limiter script on a throwaway key and paces 2 s at 80/s;
 *   3. lists the live limiter state of numbers currently sending
 *      (rate, and when Meta last throttled them).
 *
 * Read-only apart from the throwaway key (deleted at the end).
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // environment from the shell
}

async function main() {
  const { getRedis, closeRedis, redisEnabled, describeRedisError } =
    await import('@/lib/redis/client');
  if (!redisEnabled()) {
    console.error('REDIS_URL is not set.');
    process.exit(1);
  }
  const redis = getRedis()!;
  const url = new URL(process.env.REDIS_URL!);
  console.log(
    `1. Connecting to ${url.protocol}//${url.hostname}:${url.port || 6379} …`
  );
  await new Promise<void>((resolve, reject) => {
    if (redis.status === 'ready') return resolve();
    redis.once('ready', () => resolve());
    redis.once('error', (err) => reject(new Error(describeRedisError(err))));
    setTimeout(() => reject(new Error('not ready after 10 s')), 10_000);
  });
  const t0 = Date.now();
  console.log(`   PING → ${await redis.ping()} (${Date.now() - t0} ms)`);
  const info = await redis.info('server');
  console.log(`   Redis ${/redis_version:(\S+)/.exec(info)?.[1] ?? '?'}`);

  console.log('2. Pacing 2 s through the shared limiter at 80/s …');
  const { RedisChannelLimiter } =
    await import('@/lib/campaigns/channel-limiter');
  const pn = `check-${process.pid}-${Date.now()}`;
  const limiter = new RedisChannelLimiter(redis, pn, 80);
  let granted = 0;
  const until = Date.now() + 2_000;
  await Promise.all(
    Array.from({ length: 50 }, async () => {
      while (Date.now() < until) {
        await limiter.acquire();
        if (Date.now() < until) granted++;
      }
    })
  );
  console.log(
    `   ${granted} slots in 2 s (expect ~155–160) — ${granted >= 140 && granted <= 165 ? 'OK' : 'CHECK'}`
  );
  await redis.del(`ratelimit:channel:${pn}`);

  console.log('3. Numbers with limiter state (active in the last hour):');
  const keys: string[] = [];
  let cursor = '0';
  do {
    // SCAN ignores keyPrefix — match the full key.
    const [next, found] = await redis.scan(
      cursor,
      'MATCH',
      'wacrm:ratelimit:channel:*',
      'COUNT',
      200
    );
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0' && keys.length < 200);
  if (!keys.length) console.log('   none');
  for (const full of keys) {
    const key = full.replace(/^wacrm:/, '');
    const h = await redis.hgetall(key);
    const penalty = Number(h.penalty);
    console.log(
      `   ${key.replace('ratelimit:channel:', 'phone_number_id ')}: ` +
        `rate ${Number(h.rate).toFixed(1)}/${h.max} msg/s, ` +
        (penalty
          ? `last throttled ${Math.round(Date.now() / 1000 - penalty)} s ago`
          : 'never throttled')
    );
  }
  await closeRedis();
  console.log('Redis is ready for campaign sending.');
}

main().catch((err) => {
  console.error(
    'Redis check failed:',
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});

export {};
