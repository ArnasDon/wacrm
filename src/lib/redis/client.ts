// ============================================================
// Shared Redis connection (optional).
//
// Set REDIS_URL to enable it — `redis://host:6379` locally, or
// `rediss://…` (TLS) for Amazon ElastiCache / MemoryDB with in-transit
// encryption. When it's unset, or the server can't be reached, callers
// fall back to per-process state; nothing here ever throws or crashes
// the process.
//
// Commands fail fast while disconnected (no offline queue), so a Redis
// outage degrades pacing to per-process instead of stalling sends.
// ============================================================

import Redis from 'ioredis';

const g = globalThis as unknown as {
  __wacrmRedis?: Redis | null;
  __wacrmRedisLoggedAt?: number;
};

export function redisEnabled(): boolean {
  return !!process.env.REDIS_URL?.trim();
}

/** The process-wide client, or null when REDIS_URL isn't set. */
export function getRedis(): Redis | null {
  if (g.__wacrmRedis !== undefined) return g.__wacrmRedis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return (g.__wacrmRedis = null);

  const client = new Redis(url, {
    // Fail a command quickly instead of queueing it behind a reconnect:
    // the caller falls back to local pacing.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 2_000,
    // Keep reconnecting forever, backing off to 5 s.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    keyPrefix: 'wacrm:',
    connectionName: 'wacrm',
  });
  // An 'error' event with no listener would crash the process.
  client.on('error', (err) => logRedisError(err));
  g.__wacrmRedis = client;
  return client;
}

/** Log Redis trouble at most once every 30 s. */
export function logRedisError(err: unknown): void {
  const now = Date.now();
  if (now - (g.__wacrmRedisLoggedAt ?? 0) < 30_000) return;
  g.__wacrmRedisLoggedAt = now;
  console.error(
    '[redis] unavailable, pacing per process until it is back:',
    describeRedisError(err)
  );
}

/**
 * A readable reason. A refused connection arrives as an AggregateError
 * with an empty message (one attempt per address, ::1 and 127.0.0.1) —
 * show its code instead, plus a hint.
 */
export function describeRedisError(err: unknown): string {
  const e = err as {
    message?: string;
    code?: string;
    errors?: { code?: string; message?: string }[];
  };
  const code = e?.code ?? e?.errors?.[0]?.code;
  const message = e?.message || e?.errors?.[0]?.message || '';
  if (code === 'ECONNREFUSED')
    return `connection refused (${message || code}) — is Redis running? macOS: brew services start redis`;
  return [code, message].filter(Boolean).join(' ') || String(err);
}

/** For tests: use this client (e.g. ioredis-mock) instead of REDIS_URL. */
export function setRedisForTests(client: Redis | null): void {
  g.__wacrmRedis = client;
}

export async function closeRedis(): Promise<void> {
  const client = g.__wacrmRedis;
  g.__wacrmRedis = undefined;
  if (client) await client.quit().catch(() => client.disconnect());
}
