// Campaign speed log — types and the per-second aggregation, safe to use
// in the browser (the writer, with its Node-only process metrics, is in
// speed-log.ts).

export type SpeedEvent = 'sent' | 'accepted' | 'throttled' | 'failed';

export interface SpeedEventInfo {
  type: SpeedEvent;
  /** ms epoch when it happened. */
  at: number;
  /** Limiter pace (msg/s) at the time. */
  rate: number;
  /** Requests open to Meta on this sender right now, and its cap. */
  inFlight?: number;
  maxInFlight?: number;
  /** The number's Meta tier (80 / 1 000) and the campaign's own cap. */
  tierRate?: number;
  capRate?: number;
}

/** One row of campaign_speed_log (migrations 056 + 057). */
export interface SpeedLogRow {
  whatsapp_config_id: string | null;
  second: string;
  sent: number;
  accepted: number;
  throttled: number;
  failed: number;
  limit_rate: number | string | null;
  worker?: string | null;
  role?: string | null;
  path?: string | null;
  in_flight?: number | null;
  max_in_flight?: number | null;
  tier_rate?: number | string | null;
  cap_rate?: number | string | null;
  rss_mb?: number | string | null;
  heap_mb?: number | string | null;
  cpu_pct?: number | string | null;
  load_avg?: number | string | null;
  event_loop_lag_ms?: number | string | null;
}

export interface ChannelSecond {
  sent: number;
  accepted: number;
  throttled: number;
  failed: number;
  /** Limiter pace (max across workers — they share the number's limit). */
  limit: number;
  tier: number;
  cap: number;
  inFlight: number;
  maxInFlight: number;
}

export interface WorkerSecond {
  role: string;
  path: string;
  sent: number;
  rssMb: number;
  heapMb: number;
  cpuPct: number;
  loadAvg: number;
  lagMs: number;
}

export interface SpeedSecond {
  /** ms epoch of the second. */
  at: number;
  sent: number;
  accepted: number;
  throttled: number;
  failed: number;
  /** Sum of the channels' limiter pace (msg/s). */
  limit: number;
  /** Sum of the channels' Meta tiers (msg/s). */
  tier: number;
  inFlight: number;
  maxInFlight: number;
  /** Processes that sent this second. */
  workers: number;
  /** Totals across those workers. */
  rssMb: number;
  heapMb: number;
  cpuPct: number;
  /** Highest machine load average / event-loop lag among them. */
  loadAvg: number;
  lagMs: number;
  byChannel: Record<string, ChannelSecond>;
  byWorker: Record<string, WorkerSecond>;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

const empty = (at: number): SpeedSecond => ({
  at,
  sent: 0,
  accepted: 0,
  throttled: 0,
  failed: 0,
  limit: 0,
  tier: 0,
  inFlight: 0,
  maxInFlight: 0,
  workers: 0,
  rssMb: 0,
  heapMb: 0,
  cpuPct: 0,
  loadAvg: 0,
  lagMs: 0,
  byChannel: {},
  byWorker: {},
});

/**
 * Rows → one entry per second (rows from several workers / channels
 * combined), in time order, with empty seconds between the first and
 * last filled in as zeros so pauses are visible.
 */
export function speedSeconds(rows: SpeedLogRow[]): SpeedSecond[] {
  const map = new Map<number, SpeedSecond>();
  for (const r of rows) {
    const at = Date.parse(r.second);
    if (!Number.isFinite(at)) continue;
    const s = map.get(at) ?? empty(at);
    const c = (s.byChannel[r.whatsapp_config_id ?? ''] ??= {
      sent: 0,
      accepted: 0,
      throttled: 0,
      failed: 0,
      limit: 0,
      tier: 0,
      cap: 0,
      inFlight: 0,
      maxInFlight: 0,
    });
    for (const k of ['sent', 'accepted', 'throttled', 'failed'] as const) {
      s[k] += r[k];
      c[k] += r[k];
    }
    // Workers on one channel share its limit: take the max, don't add.
    c.limit = Math.max(c.limit, num(r.limit_rate));
    c.tier = Math.max(c.tier, num(r.tier_rate));
    c.cap = Math.max(c.cap, num(r.cap_rate));
    c.inFlight += num(r.in_flight);
    c.maxInFlight += num(r.max_in_flight);

    const wk = r.worker ?? '';
    if (wk) {
      const w = (s.byWorker[wk] ??= {
        role: r.role ?? '',
        path: r.path ?? '',
        sent: 0,
        rssMb: 0,
        heapMb: 0,
        cpuPct: 0,
        loadAvg: 0,
        lagMs: 0,
      });
      w.sent += r.sent;
      w.rssMb = Math.max(w.rssMb, num(r.rss_mb));
      w.heapMb = Math.max(w.heapMb, num(r.heap_mb));
      w.cpuPct = Math.max(w.cpuPct, num(r.cpu_pct));
      w.loadAvg = Math.max(w.loadAvg, num(r.load_avg));
      w.lagMs = Math.max(w.lagMs, num(r.event_loop_lag_ms));
    }
    map.set(at, s);
  }

  const seconds = [...map.values()].sort((a, b) => a.at - b.at);
  for (const s of seconds) {
    const chans = Object.values(s.byChannel);
    s.limit = chans.reduce((a, c) => a + c.limit, 0);
    s.tier = chans.reduce((a, c) => a + c.tier, 0);
    s.inFlight = chans.reduce((a, c) => a + c.inFlight, 0);
    s.maxInFlight = chans.reduce((a, c) => a + c.maxInFlight, 0);
    const workers = Object.values(s.byWorker);
    s.workers = workers.length;
    s.rssMb = workers.reduce((a, w) => a + w.rssMb, 0);
    s.heapMb = workers.reduce((a, w) => a + w.heapMb, 0);
    s.cpuPct = workers.reduce((a, w) => a + w.cpuPct, 0);
    s.loadAvg = Math.max(0, ...workers.map((w) => w.loadAvg));
    s.lagMs = Math.max(0, ...workers.map((w) => w.lagMs));
  }
  if (seconds.length < 2) return seconds;
  const filled: SpeedSecond[] = [];
  for (let t = seconds[0].at; t <= seconds[seconds.length - 1].at; t += 1000)
    filled.push(map.get(t) ?? empty(t));
  return filled;
}
