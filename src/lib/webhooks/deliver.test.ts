import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SqlConnection } from '@/lib/db/transaction';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

// Control the SSRF guard per-test.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { dispatchWebhookEvent, MAX_CONSECUTIVE_FAILURES } from './deliver';
import { isDeliverableUrl } from './ssrf';

interface Row {
  id: string;
  url: string;
  secret: string;
}
interface Calls {
  updates: { id: string; payload: Record<string, unknown> }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
}

function makeDb(rows: Row[], calls: Calls) {
  return { query: async (sql:string,values:unknown[]=[])=>{
    expect(sql).toContain('account_id=$1');
    expect(values[0]).toBe('acct-1');
    if(sql.startsWith('SELECT')) return {rows};
    if(sql.includes('failure_count=failure_count+1')) calls.rpcs.push({name:'record_webhook_failure',args:{endpoint_id:values[1],max_failures:values[2]}});
    else calls.updates.push({id:values[1] as string,payload:{failure_count:0}});
    return {rows:[]};
  } } satisfies SqlConnection;
}

const emptyCalls = (): Calls => ({ updates: [], rpcs: [] });

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('dispatchWebhookEvent', () => {
  it('signs + POSTs (no redirect follow) and resets failure_count on success', async () => {
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
    expect(calls.updates[0]).toMatchObject({ id: 'a', payload: { failure_count: 0 } });
    expect(calls.rpcs).toHaveLength(0);
  });

  it('records an atomic failure (RPC) when the endpoint errors', async () => {
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
    expect(calls.updates).toHaveLength(0);
  });

  it('blocks a non-public target (SSRF guard) without fetching', async () => {
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
  });

  it('does nothing when no endpoints are subscribed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();
    await dispatchWebhookEvent(makeDb([], calls), 'acct-1', 'message.received', {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });
});
