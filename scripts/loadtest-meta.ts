/**
 * Load test for campaign sending — `npm run loadtest:meta`.
 *
 * Starts a local stand-in for the Graph API and drives the real
 * ChannelSender (pacing, in-flight cap, retries, error handling, pooled
 * HTTP client) against it. No WhatsApp number, no database, no cost.
 *
 * The mock behaves like Meta under load:
 *   - latency 300–1500 ms per request, like the real Graph API (--latency-min / --latency-max)
 *   - enforces a per-number throughput cap (--meta-cap msg/s) and answers
 *     130429 above it, like Cloud API does
 *   - injects errors: --err-5xx, --err-recipient (131026), --err-reset
 *     (socket dropped after receiving = "unknown" outcome), in percent
 *
 * Usage:
 *   npm run loadtest:meta                                   # 1 000 msg/s, 20 000 msgs
 *   npm run loadtest:meta -- --rate 80 --messages 2000 --meta-cap 80
 *   npm run loadtest:meta -- --rate 1000 --meta-cap 600     # watch it adapt down
 *   npm run loadtest:meta -- --channels 3 --rate 1000       # 3 numbers in parallel
 *   npm run loadtest:meta -- --rate 80 --meta-cap 80 --campaigns 2
 *       # 2 campaigns on one number: they share its 80/s (channel-limiter)
 *   add --redis-mock to pace through the Redis limiter (in-memory Redis),
 *   or set REDIS_URL to use a real one.
 */
import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const RATE = arg('rate', 1000);
const MESSAGES = arg('messages', 20_000);
const CHANNELS = arg('channels', 1);
/** Campaigns sending through each number at the same time. */
const CAMPAIGNS = arg('campaigns', 1);
const REDIS_MOCK = process.argv.includes('--redis-mock');
const META_CAP = arg('meta-cap', RATE);
const LAT_MIN = arg('latency-min', 300);
const LAT_MAX = arg('latency-max', 1500);
const ERR_5XX = arg('err-5xx', 0.5) / 100;
const ERR_RECIPIENT = arg('err-recipient', 0.5) / 100;
const ERR_RESET = arg('err-reset', 0.1) / 100;

// ── Mock Graph API ────────────────────────────────────────────────
const windows = new Map<string, number[]>();
let served = 0;
let throttledByMock = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const pnid = req.url?.split('/')[2] ?? 'x';
    const now = Date.now();
    const w = (windows.get(pnid) ?? []).filter((t) => now - t < 1000);
    w.push(now);
    windows.set(pnid, w);
    const reply = (status: number, json: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const latency = LAT_MIN + Math.random() * (LAT_MAX - LAT_MIN);
    setTimeout(() => {
      served++;
      if (w.length > META_CAP) {
        throttledByMock++;
        return reply(400, {
          error: {
            code: 130429,
            message: 'Rate limit hit',
            type: 'OAuthException',
          },
        });
      }
      const r = Math.random();
      if (r < ERR_RESET) return req.socket.destroy();
      if (r < ERR_RESET + ERR_5XX)
        return reply(500, {
          error: { code: 131000, message: 'Something went wrong' },
        });
      if (r < ERR_RESET + ERR_5XX + ERR_RECIPIENT) {
        return reply(400, {
          error: { code: 131026, message: 'Message undeliverable' },
        });
      }
      reply(200, {
        messaging_product: 'whatsapp',
        messages: [{ id: `wamid.${served}` }],
      });
    }, latency);
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  // Must be set before meta-api is loaded.
  process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${port}`;
  if (REDIS_MOCK) {
    const { default: RedisMock } = await import('ioredis-mock');
    const { setRedisForTests } = await import('@/lib/redis/client');
    setRedisForTests(
      new RedisMock({
        keyPrefix: 'wacrm:',
      }) as unknown as import('ioredis').default
    );
  }
  const { redisEnabled } = await import('@/lib/redis/client');
  const { ChannelSender } = await import('@/lib/campaigns/channel-sender');
  const { channelSpeeds } = await import('@/lib/campaigns/metrics');
  const sendTimes: { whatsapp_config_id: string; sent_at: string }[] = [];
  // Same as real campaigns: the number's cap.
  // --tier-cap: what the tier promises (sender target); --meta-cap: what the
  // mock actually allows. Lower meta-cap to watch the limiter adapt.
  const TIER = arg('tier-cap', META_CAP);
  const effective = Math.max(1, Math.min(RATE, TIER));

  const template = {
    name: 'loadtest',
    language: 'en_US',
    body_text: 'Hi {{1}}',
  } as never;
  // One sender per (campaign, number); senders on the same number share
  // its limiter, like concurrent campaigns do in production.
  const senders = Array.from(
    { length: CHANNELS * CAMPAIGNS },
    (_, i) =>
      new ChannelSender({
        phoneNumberId: `pn${i % CHANNELS}`,
        accessToken: 'test',
        rate: effective,
        maxRate: TIER,
      })
  );

  console.log(
    `Load test: ${MESSAGES} messages over ${CHANNELS} channel(s) at ${RATE} msg/s each, ` +
      `${CAMPAIGNS} campaign(s) per channel, pacing ${REDIS_MOCK ? 'Redis (in-memory mock)' : redisEnabled() ? 'Redis (REDIS_URL)' : 'in-process'} ` +
      `(mock Meta cap ${META_CAP}/s, latency ${LAT_MIN}-${LAT_MAX} ms, ` +
      `errors 5xx ${ERR_5XX * 100}% recipient ${ERR_RECIPIENT * 100}% reset ${ERR_RESET * 100}%)\n`
  );

  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const latencies: number[] = [];
  const outcomes: Record<string, number> = {};
  let done = 0;
  let peakRss = 0;
  const started = Date.now();
  let lastDone = 0;
  const ticker = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    const snap = senders.map((s) => s.snapshot());
    console.log(
      `t=${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  ` +
        `done/s=${String(done - lastDone).padStart(5)}  total=${String(done).padStart(6)}  ` +
        `in-flight=${snap.reduce((a, s) => a + s.inFlight, 0)}  ` +
        `rate=${snap
          .slice(0, CHANNELS)
          .map((s) => s.rate)
          .join('/')}  throttled=${snap.reduce((a, s) => a + s.throttled, 0)}`
    );
    lastDone = done;
  }, 1000);

  await Promise.all(
    Array.from({ length: MESSAGES }, async (_, i) => {
      const sender = senders[i % senders.length];
      const t0 = Date.now();
      const res = await sender.send({
        phone: `9198${String(i).padStart(8, '0')}`,
        template,
        params: { body: [`U${i}`] },
      });
      latencies.push(Date.now() - t0);
      if (res.ok)
        sendTimes.push({
          whatsapp_config_id: `pn${i % CHANNELS}`,
          sent_at: new Date(res.sentAt).toISOString(),
        });
      const key = res.ok ? 'sent' : `failed:${res.error.action}`;
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      done++;
    })
  );

  clearInterval(ticker);
  loop.disable();
  const secs = (Date.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  const stats = senders.map((s) => s.snapshot());

  console.log('\n── Result ──────────────────────────────────────');
  console.log(`messages        ${MESSAGES} in ${secs.toFixed(1)} s`);
  console.log(
    `throughput      ${(MESSAGES / secs).toFixed(0)} msg/s overall ` +
      `(sender target ${effective}/s × ${CHANNELS} channel(s) of the ${TIER}/s tier; mock Meta allows ${META_CAP}/s per number)`
  );
  // What the campaign page shows: per channel over its own send times,
  // added up.
  const speeds = channelSpeeds(sendTimes, { sending: false, now: Date.now() });
  console.log(
    `campaign page   ${speeds.reduce((a, c) => a + Math.round(c.rate), 0)} msg/s (` +
      speeds.map((c) => `${c.channelId}: ${Math.round(c.rate)}`).join(' + ') +
      ')'
  );
  console.log(`outcomes        ${JSON.stringify(outcomes)}`);
  console.log(
    `retries         transient ${stats.reduce((a, s) => a + s.retried, 0)}, throttle ${stats.reduce((a, s) => a + s.throttled, 0)} (mock returned 130429 ×${throttledByMock})`
  );
  console.log(
    `latency (queue+send)  p50 ${pct(0.5)} ms  p95 ${pct(0.95)} ms  p99 ${pct(0.99)} ms`
  );
  console.log(
    `event loop delay      p99 ${(loop.percentile(99) / 1e6).toFixed(1)} ms  max ${(loop.max / 1e6).toFixed(1)} ms`
  );
  console.log(`peak memory (RSS)     ${(peakRss / 1024 / 1024).toFixed(0)} MB`);
  const lost = MESSAGES - Object.values(outcomes).reduce((a, b) => a + b, 0);
  console.log(
    `unaccounted     ${lost} (must be 0 — every message got an outcome, nothing crashed)`
  );
  server.close();
  process.exit(lost === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('load test crashed:', err);
  process.exit(1);
});

export {};
