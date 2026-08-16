import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

// Control the SSRF guard per-test.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import {
  dispatchWebhookEvent,
  retryDelivery,
  MAX_CONSECUTIVE_FAILURES,
  RETRY_DELAYS_MS,
} from './deliver';
import { isDeliverableUrl } from './ssrf';

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
  is_active?: boolean;
}
interface Calls {
  endpointUpdates: { id: string; payload: Record<string, unknown> }[];
  deliveryInserts: Record<string, unknown>[];
  deliveryUpdates: { id: string; payload: Record<string, unknown> }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
}

/**
 * Per-table fake. `webhook_endpoints` behaves as before (select the
 * subscribed rows, or a single row by id for retryDelivery; update
 * captured). `webhook_deliveries` supports insert (returns a fresh id)
 * and update (captured) — the two new query shapes `deliver.ts` needs
 * post-retry-log.
 */
function makeDb(endpointRows: EndpointRow[], calls: Calls, deliveryIdSeq = 'd'): SupabaseClient {
  let deliveryCounter = 0;
  const from = (table: string) => {
    let mode: 'select' | 'update' | 'insert' = 'select';
    let updatePayload: Record<string, unknown> = {};
    let updateId: string | null = null;
    let eqById: string | null = null;

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, val: string) => {
        if (col === 'id') {
          updateId = val;
          eqById = val;
        }
        return b;
      },
      update: (p: Record<string, unknown>) => {
        mode = 'update';
        updatePayload = p;
        return b;
      },
      insert: (p: Record<string, unknown>) => {
        mode = 'insert';
        if (table === 'webhook_deliveries') calls.deliveryInserts.push(p);
        return b;
      },
      contains: () => Promise.resolve({ data: endpointRows, error: null }),
      maybeSingle: async () => {
        if (table === 'webhook_endpoints') {
          const row = endpointRows.find((r) => r.id === eqById) ?? null;
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (table === 'webhook_deliveries' && mode === 'insert') {
          deliveryCounter++;
          return { data: { id: `${deliveryIdSeq}${deliveryCounter}` }, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (mode === 'update' && updateId) {
          if (table === 'webhook_endpoints') {
            calls.endpointUpdates.push({ id: updateId, payload: updatePayload });
          } else if (table === 'webhook_deliveries') {
            calls.deliveryUpdates.push({ id: updateId, payload: updatePayload });
          }
        }
        return resolve({ data: null, error: null });
      },
    };
    return b;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.rpcs.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const emptyCalls = (): Calls => ({
  endpointUpdates: [],
  deliveryInserts: [],
  deliveryUpdates: [],
  rpcs: [],
});

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('dispatchWebhookEvent', () => {
  it('signs + POSTs (no redirect follow), logs the attempt, and resets failure_count on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'a', url: 'https://a.test/hook', secret: 's1' }], calls),
      'acct-1',
      'message.received',
      { x: 1 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://a.test/hook');
    expect(opts.redirect).toBe('manual');
    expect(opts.headers['X-Wacrm-Event']).toBe('message.received');
    expect(opts.headers['X-Wacrm-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // Payload carries a dedupe id.
    expect(JSON.parse(opts.body).id).toMatch(/[0-9a-f-]{36}/);
    expect(calls.endpointUpdates[0]).toMatchObject({ id: 'a', payload: { failure_count: 0 } });
    expect(calls.rpcs).toHaveLength(0);

    // A delivery-log row was created up front and marked delivered.
    expect(calls.deliveryInserts).toHaveLength(1);
    expect(calls.deliveryInserts[0]).toMatchObject({ endpoint_id: 'a', event: 'message.received', status: 'pending' });
    expect(calls.deliveryUpdates[0]).toMatchObject({
      payload: { status: 'delivered', attempt_count: 1, response_status: 200, next_retry_at: null },
    });
  });

  it('records an atomic endpoint failure (RPC) AND schedules the first retry when an attempt errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'b', url: 'https://b.test/hook', secret: 's2' }], calls),
      'acct-1',
      'message.received',
      {}
    );

    expect(calls.rpcs[0]).toEqual({
      name: 'record_webhook_failure',
      args: { endpoint_id: 'b', max_failures: MAX_CONSECUTIVE_FAILURES },
    });
    expect(calls.endpointUpdates).toHaveLength(0);

    // attempt_count=1 failing schedules the first retry delay, stays pending.
    expect(calls.deliveryUpdates[0].payload).toMatchObject({
      status: 'pending',
      attempt_count: 1,
      response_status: 500,
    });
    const scheduled = new Date(calls.deliveryUpdates[0].payload.next_retry_at as string).getTime();
    expect(scheduled).toBeGreaterThan(Date.now() + RETRY_DELAYS_MS[0] - 5000);
    expect(scheduled).toBeLessThanOrEqual(Date.now() + RETRY_DELAYS_MS[0] + 5000);
  });

  it('blocks a non-public target (SSRF guard) without fetching, still logs + schedules retry', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'c', url: 'https://127.0.0.1/hook', secret: 's3' }], calls),
      'acct-1',
      'message.received',
      {}
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.rpcs[0].name).toBe('record_webhook_failure');
    expect(calls.deliveryUpdates[0].payload.status).toBe('pending');
  });

  it('does nothing when no endpoints are subscribed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();
    await dispatchWebhookEvent(makeDb([], calls), 'acct-1', 'message.received', {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.endpointUpdates).toHaveLength(0);
    expect(calls.deliveryInserts).toHaveLength(0);
  });
});

describe('retryDelivery', () => {
  it('marks delivered on a successful retry and clears next_retry_at', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
    const calls = emptyCalls();
    const db = makeDb([{ id: 'e1', url: 'https://e1.test/hook', secret: 's', is_active: true }], calls);

    await retryDelivery(db, {
      id: 'del-1',
      endpoint_id: 'e1',
      event: 'deal.won',
      attempt_count: 1,
      payload: { id: 'evt-1', event: 'deal.won', data: {} },
    });

    expect(calls.deliveryUpdates[0]).toMatchObject({
      id: 'del-1',
      payload: { status: 'delivered', attempt_count: 2, next_retry_at: null },
    });
  });

  it('schedules the next backoff step on a second consecutive failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
    const calls = emptyCalls();
    const db = makeDb([{ id: 'e2', url: 'https://e2.test/hook', secret: 's', is_active: true }], calls);

    await retryDelivery(db, {
      id: 'del-2',
      endpoint_id: 'e2',
      event: 'deal.won',
      attempt_count: 1,
      payload: { id: 'evt-2', event: 'deal.won', data: {} },
    });

    expect(calls.deliveryUpdates[0].payload).toMatchObject({ status: 'pending', attempt_count: 2 });
    const scheduled = new Date(calls.deliveryUpdates[0].payload.next_retry_at as string).getTime();
    expect(scheduled).toBeGreaterThan(Date.now() + RETRY_DELAYS_MS[1] - 5000);
  });

  it('exhausts the schedule after the final retry and marks the delivery failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const calls = emptyCalls();
    const db = makeDb([{ id: 'e3', url: 'https://e3.test/hook', secret: 's', is_active: true }], calls);

    // attempt_count 3 failing is the last scheduled retry (RETRY_DELAYS_MS
    // has 3 entries) — this call becomes attempt 4, which exhausts it.
    await retryDelivery(db, {
      id: 'del-3',
      endpoint_id: 'e3',
      event: 'deal.won',
      attempt_count: RETRY_DELAYS_MS.length,
      payload: { id: 'evt-3', event: 'deal.won', data: {} },
    });

    expect(calls.deliveryUpdates[0].payload).toMatchObject({
      status: 'failed',
      attempt_count: RETRY_DELAYS_MS.length + 1,
      next_retry_at: null,
    });
    // Still bumps the endpoint's consecutive-failure streak like every attempt.
    expect(calls.rpcs[0].name).toBe('record_webhook_failure');
  });

  it('marks the delivery failed without attempting when the endpoint was disabled/deleted since queuing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();
    const db = makeDb([{ id: 'e4', url: 'https://e4.test/hook', secret: 's', is_active: false }], calls);

    await retryDelivery(db, {
      id: 'del-4',
      endpoint_id: 'e4',
      event: 'deal.won',
      attempt_count: 1,
      payload: { id: 'evt-4', event: 'deal.won', data: {} },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.deliveryUpdates[0]).toMatchObject({ id: 'del-4', payload: { status: 'failed' } });
  });
});
