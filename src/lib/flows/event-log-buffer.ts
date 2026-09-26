// ============================================================
// In-memory batching for `flow_run_events` inserts.
//
// `logEvent` in engine.ts is fire-and-forget audit logging (node
// entered / message sent / fallback fired / etc.) — losing a few rows
// on a crash is acceptable, unlike `recordInboundOnce`'s dedup insert
// (kept as a direct, unbuffered insert; batching it would defeat the
// unique-constraint-based idempotency check it relies on).
//
// Trade-off: this app runs as a Cloudflare Worker (see
// docs/deployment-cloudflare.md), where a bare `setInterval` is not
// guaranteed to fire between requests — an idle isolate can be evicted
// with a non-empty buffer sitting in memory. The size/time flush below
// still helps within a single busy isolate and for any Node.js
// deployment, but the load-bearing flush is the explicit one each
// caller performs at the end of its own request / cron tick (see
// `dispatchInboundToFlows` and `resumeDueWaits` in engine.ts), so nothing
// is left stranded when the isolate goes away right after responding.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface FlowRunEventInsert {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
}

const MAX_BATCH_SIZE = 25;
const FLUSH_INTERVAL_MS = 3000;

let buffer: FlowRunEventInsert[] = [];
let boundDb: SupabaseClient | null = null;
let flushing: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Queue a row for the next batched insert. Never throws. */
export function enqueueFlowRunEvent(
  db: SupabaseClient,
  row: FlowRunEventInsert,
): void {
  buffer.push(row);
  boundDb = db;
  ensureTimer();
  if (buffer.length >= MAX_BATCH_SIZE) {
    void flushFlowRunEvents();
  }
}

/** Insert every buffered row in one request, clearing the buffer first
 * so rows queued while the insert is in flight land in the next flush. */
export async function flushFlowRunEvents(): Promise<void> {
  if (flushing) return flushing;
  if (buffer.length === 0 || !boundDb) return;
  const rows = buffer;
  buffer = [];
  const db = boundDb;
  flushing = (async () => {
    const { error } = await db.from("flow_run_events").insert(rows);
    if (error) {
      console.error(
        "[flows] batched flow_run_events insert failed:",
        error.message,
      );
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function ensureTimer(): void {
  if (timer || typeof setInterval !== "function") return;
  timer = setInterval(() => {
    void flushFlowRunEvents();
  }, FLUSH_INTERVAL_MS);
  // Node only — don't keep an otherwise-idle process alive just for this.
  const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") maybeUnref.call(timer);
}

if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("SIGTERM", () => {
    void flushFlowRunEvents();
  });
}
