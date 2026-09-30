// ============================================================
// Per-second speed log for a campaign (migrations 056, 057). Server only.
//
// Every attempt a ChannelSender makes is counted in the second it
// happened, per channel and per worker process:
//   sent       a request left for Meta (retries included) — our speed
//   accepted   Meta accepted it (returned a message id) — Meta's speed
//   throttled  Meta answered 130429 "too fast"
//   failed     Meta (or the network) rejected it otherwise
// together with, for that second:
//   rate limits  the number's Meta tier, the campaign's cap and the
//                limiter's current pace
//   concurrency  requests open to Meta and the cap on them
//   the worker   host:pid, role (app / kafka-worker), path (kafka /
//                in-process), memory (RSS, heap), CPU %, load average,
//                event-loop lag — sampled once a second
//                (lib/process-metrics.ts), not per message.
//
// Buckets are written in small batches (completed seconds every 2 s,
// the rest on flush()), so logging never slows sending. Best-effort:
// a failed write is logged once and dropped; if the table isn't there
// yet (migration not applied) logging switches itself off.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { processSnapshot, type ProcessSnapshot } from '@/lib/process-metrics';
import type { SpeedEventInfo } from './speed-log-shared';

export * from './speed-log-shared';

interface Bucket {
  channelId: string | null;
  second: number;
  sent: number;
  accepted: number;
  throttled: number;
  failed: number;
  rate: number;
  inFlight: number;
  maxInFlight: number;
  tierRate: number;
  capRate: number;
  proc: ProcessSnapshot;
}

const FLUSH_MS = 2_000;
const MAX_BUCKETS = 20_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export class CampaignSpeedLog {
  private buckets = new Map<string, Bucket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private writing: Promise<void> | null = null;
  private disabled = false;
  /** Migration 057 not applied: write the 056 columns only. */
  private basicOnly = false;
  private warned = false;

  constructor(
    private readonly db: SupabaseClient,
    private readonly accountId: string,
    private readonly broadcastId: string,
    /** How this campaign is being sent. */
    private readonly path: 'kafka' | 'in-process' = 'in-process'
  ) {}

  /** Event callback for one channel's sender. */
  forChannel(channelId: string | null): (e: SpeedEventInfo) => void {
    return (e) => this.record(channelId, e);
  }

  record(channelId: string | null, e: SpeedEventInfo): void {
    if (this.disabled) return;
    const second = Math.floor(e.at / 1000);
    const key = `${channelId ?? ''}|${second}`;
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= MAX_BUCKETS) return; // DB far behind: drop
      b = {
        channelId,
        second,
        sent: 0,
        accepted: 0,
        throttled: 0,
        failed: 0,
        rate: e.rate,
        inFlight: 0,
        maxInFlight: 0,
        tierRate: 0,
        capRate: 0,
        proc: processSnapshot(),
      };
      this.buckets.set(key, b);
    }
    b[e.type]++;
    b.rate = e.rate;
    b.inFlight = Math.max(b.inFlight, e.inFlight ?? 0);
    b.maxInFlight = e.maxInFlight ?? b.maxInFlight;
    b.tierRate = e.tierRate ?? b.tierRate;
    b.capRate = e.capRate ?? b.capRate;
    b.proc = processSnapshot();
    if (!this.timer) {
      this.timer = setInterval(() => void this.write(false), FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Write everything, including the current second. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.write(true);
  }

  private toRow(b: Bucket) {
    const basic = {
      account_id: this.accountId,
      broadcast_id: this.broadcastId,
      whatsapp_config_id: b.channelId,
      second: new Date(b.second * 1000).toISOString(),
      sent: b.sent,
      accepted: b.accepted,
      throttled: b.throttled,
      failed: b.failed,
      limit_rate: r2(b.rate),
    };
    if (this.basicOnly) return basic;
    return {
      ...basic,
      worker: b.proc.worker,
      role: b.proc.role,
      path: this.path,
      in_flight: b.inFlight,
      max_in_flight: b.maxInFlight,
      tier_rate: r2(b.tierRate),
      cap_rate: r2(b.capRate),
      rss_mb: b.proc.rssMb,
      heap_mb: b.proc.heapMb,
      cpu_pct: b.proc.cpuPct,
      load_avg: b.proc.loadAvg,
      event_loop_lag_ms: b.proc.eventLoopLagMs,
    };
  }

  private async write(all: boolean): Promise<void> {
    while (this.writing) await this.writing;
    const nowSec = Math.floor(Date.now() / 1000);
    const ready = [...this.buckets.entries()].filter(
      ([, b]) => all || b.second < nowSec
    );
    if (!ready.length || this.disabled) return;
    for (const [key] of ready) this.buckets.delete(key);
    const buckets = ready.map(([, b]) => b);
    this.writing = (async () => {
      try {
        let { error } = await this.db
          .from('campaign_speed_log')
          .insert(buckets.map((b) => this.toRow(b)));
        // New columns missing (057 not applied): fall back to 056's.
        if (error && !this.basicOnly && /column/i.test(error.message)) {
          this.basicOnly = true;
          ({ error } = await this.db
            .from('campaign_speed_log')
            .insert(buckets.map((b) => this.toRow(b))));
        }
        if (error) throw new Error(error.message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/campaign_speed_log|relation|schema cache/i.test(msg)) {
          this.disabled = true; // table not there (migration 056)
        }
        if (!this.warned) {
          this.warned = true;
          console.warn('[speed-log] could not write the speed log:', msg);
        }
      }
    })().finally(() => {
      this.writing = null;
    });
    await this.writing;
  }
}
