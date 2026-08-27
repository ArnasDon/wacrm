import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/platform/admin-client', () => ({
  platformAdminClient: () => ({ from: h.from, rpc: h.rpc }),
}));

import {
  loadHeartbeatHealth,
  recordHeartbeat,
  HEARTBEATS,
  STALE_MULTIPLIER,
} from './heartbeat';

beforeEach(() => {
  h.from.mockReset();
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ error: null });
});

function mockRows(rows: unknown[]) {
  h.from.mockReturnValue({ select: () => Promise.resolve({ data: rows, error: null }) });
}

describe('loadHeartbeatHealth', () => {
  it('marks a job that never ran as stale / never', async () => {
    mockRows([]);
    const out = await loadHeartbeatHealth();
    expect(out).toHaveLength(Object.keys(HEARTBEATS).length);
    for (const h of out) {
      expect(h.stale).toBe(true);
      expect(h.lastStatus).toBe('never');
      expect(h.ageSeconds).toBeNull();
    }
  });

  it('marks a fresh run as healthy', async () => {
    mockRows([
      {
        name: 'automations_cron',
        last_run_at: new Date(Date.now() - 30_000).toISOString(),
        last_status: 'ok',
        expected_interval_seconds: 300,
        runs_total: 5,
      },
    ]);
    const out = await loadHeartbeatHealth();
    const auto = out.find((x) => x.name === 'automations_cron')!;
    expect(auto.stale).toBe(false);
    expect(auto.lastStatus).toBe('ok');
  });

  it('marks a run older than STALE_MULTIPLIER * interval as stale', async () => {
    const interval = HEARTBEATS.automations_cron.expectedIntervalSeconds;
    mockRows([
      {
        name: 'automations_cron',
        last_run_at: new Date(Date.now() - (interval * STALE_MULTIPLIER + 60) * 1000).toISOString(),
        last_status: 'ok',
        expected_interval_seconds: interval,
        runs_total: 5,
      },
    ]);
    const out = await loadHeartbeatHealth();
    expect(out.find((x) => x.name === 'automations_cron')!.stale).toBe(true);
  });

  it('surfaces a last_status of error even when fresh', async () => {
    mockRows([
      {
        name: 'flows_cron',
        last_run_at: new Date().toISOString(),
        last_status: 'error',
        expected_interval_seconds: 300,
        runs_total: 1,
      },
    ]);
    const out = await loadHeartbeatHealth();
    expect(out.find((x) => x.name === 'flows_cron')!.lastStatus).toBe('error');
  });
});

describe('recordHeartbeat', () => {
  it('calls the record_heartbeat RPC with the job name + registry interval', async () => {
    await recordHeartbeat('flows_cron', { detail: 'swept 3' });
    expect(h.rpc).toHaveBeenCalledWith('record_heartbeat', {
      p_name: 'flows_cron',
      p_status: 'ok',
      p_detail: 'swept 3',
      p_interval_seconds: HEARTBEATS.flows_cron.expectedIntervalSeconds,
    });
  });

  it('never throws when the RPC fails', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(recordHeartbeat('webhooks_cron')).resolves.toBeUndefined();
  });
});
