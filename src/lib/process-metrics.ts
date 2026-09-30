// ============================================================
// Lightweight process metrics for the campaign speed log (server only).
//
// Sampled once a second in the background (never per message):
// memory (RSS, JS heap), this process's CPU %, the machine's 1-minute
// load average and event-loop lag. snapshot() just returns the latest
// sample, so calling it on every send costs nothing.
// ============================================================

import { hostname, loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface ProcessSnapshot {
  /** "host:pid" — tells workers apart. */
  worker: string;
  /** 'app' (next server) or 'kafka-worker' (npm run worker:kafka). */
  role: string;
  rssMb: number;
  heapMb: number;
  /** This process, % of one core over the last second (can exceed 100). */
  cpuPct: number;
  /** Machine load average, 1 minute. */
  loadAvg: number;
  /** Worst event-loop delay in the last second, ms. */
  eventLoopLagMs: number;
}

const g = globalThis as unknown as {
  __wacrmProcessRole?: string;
  __wacrmProcessSampler?: {
    last: ProcessSnapshot;
    timer: ReturnType<typeof setInterval>;
  };
};

/** Called by the Kafka worker entry point so its rows say so. */
export function setProcessRole(role: string): void {
  g.__wacrmProcessRole = role;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function start() {
  const worker = `${hostname()}:${process.pid}`;
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let cpu = process.cpuUsage();
  let at = process.hrtime.bigint();

  const sample = (): ProcessSnapshot => {
    const mem = process.memoryUsage();
    const nowCpu = process.cpuUsage();
    const now = process.hrtime.bigint();
    const wallUs = Number(now - at) / 1000;
    const usedUs = nowCpu.user - cpu.user + (nowCpu.system - cpu.system);
    cpu = nowCpu;
    at = now;
    const lag = loop.max / 1e6;
    loop.reset();
    return {
      worker,
      role: g.__wacrmProcessRole ?? 'app',
      rssMb: round(mem.rss / 1048576),
      heapMb: round(mem.heapUsed / 1048576),
      cpuPct: wallUs > 0 ? round((usedUs / wallUs) * 100) : 0,
      loadAvg: round(loadavg()[0], 2),
      eventLoopLagMs: Number.isFinite(lag) ? round(lag) : 0,
    };
  };

  const state = {
    last: sample(),
    timer: setInterval(() => {
      state.last = sample();
    }, 1_000),
  };
  state.timer.unref?.();
  return state;
}

/** Latest sample (starts the 1 s sampler on first use). */
export function processSnapshot(): ProcessSnapshot {
  g.__wacrmProcessSampler ??= start();
  return g.__wacrmProcessSampler.last;
}
