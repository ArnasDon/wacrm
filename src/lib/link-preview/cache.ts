import type { LinkPreviewData } from "./types";

// OG metadata rarely changes minute to minute, so a successful fetch is
// cached generously; an unavailable/failed one gets a much shorter TTL so
// a transient outage can recover reasonably soon without hammering the
// target on every render in the meantime.
const SUCCESS_TTL_MS = 60 * 60 * 1000; // 1h
const NEGATIVE_TTL_MS = 10 * 60 * 1000; // 10m

interface CacheEntry {
  data: LinkPreviewData;
  expiresAt: number;
}

// Module-scope Map, not Redis/an external KV store — this project has
// neither, and Fluid Compute reuses warm instances between requests, so a
// process-lifetime cache already does real work here (a cold start just
// starts with an empty cache, same as any in-memory cache would).
const cache = new Map<string, CacheEntry>();

// Keyed the same as `cache`. A second caller for a URL that's already
// being fetched awaits the same promise instead of firing a second
// request — the actual dedup requirement, not just a cache read.
const inFlight = new Map<string, Promise<{ status: "ok"; data: LinkPreviewData }>>();

export function getCached(key: string): LinkPreviewData | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached(key: string, data: LinkPreviewData, isPositive: boolean): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + (isPositive ? SUCCESS_TTL_MS : NEGATIVE_TTL_MS),
  });
}

export async function dedupe(
  key: string,
  run: () => Promise<{ status: "ok"; data: LinkPreviewData }>,
): Promise<{ status: "ok"; data: LinkPreviewData }> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
