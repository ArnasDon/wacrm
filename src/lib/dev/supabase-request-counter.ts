// ============================================================
// Dev-only counter for outbound Supabase requests (REST / Auth / RPC).
//
// Each one of these is a billed edge log line on the free plan, so
// this exists purely to let you compare "requests/day" before and
// after a caching/batching change locally — it patches `fetch` to
// tally calls by table/rpc/auth path, and is a total no-op unless
// NODE_ENV === 'development'. Wired in via src/instrumentation.ts.
//
// Usage:
//   - Counts print to the server console every LOG_INTERVAL_MS.
//   - GET /api/dev/supabase-request-counts returns the live tally as
//     JSON (dev-only route, 404s otherwise) — hit it, do a workflow,
//     hit it again, diff the two.
// ============================================================

const LOG_INTERVAL_MS = 30_000;

const counts = new Map<string, number>();
let installed = false;
let timer: ReturnType<typeof setInterval> | null = null;

function categorize(url: string): string | null {
  let supabaseHost: string;
  try {
    supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return null;
  }
  if (!supabaseHost) return null;

  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return null;
  }
  if (parsed.host !== supabaseHost) return null;

  const path = parsed.pathname;
  const restRpc = path.match(/^\/rest\/v1\/rpc\/([^/]+)/);
  if (restRpc) return `rpc:${restRpc[1]}`;
  const rest = path.match(/^\/rest\/v1\/([^/?]+)/);
  if (rest) return `rest:${rest[1]}`;
  const auth = path.match(/^\/auth\/v1\/([^/?]+)/);
  if (auth) return `auth:${auth[1]}`;
  return `other:${path}`;
}

export function getSupabaseRequestCounts(): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1]),
  );
}

export function resetSupabaseRequestCounts(): void {
  counts.clear();
}

function logSummary(): void {
  if (counts.size === 0) return;
  console.log("[supabase-request-counter] requests since last reset:");
  console.table(getSupabaseRequestCounts());
}

/** Idempotent — safe to import multiple times (e.g. across HMR reloads). */
export function installSupabaseRequestCounter(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = categorize(url);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    return originalFetch(input, init);
  }) as typeof fetch;

  if (!timer) {
    timer = setInterval(logSummary, LOG_INTERVAL_MS);
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === "function") maybeUnref.call(timer);
  }
}
