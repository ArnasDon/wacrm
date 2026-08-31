import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Tests for POST /api/whatsapp/connections/[id]/reconfigure-webhook.
//
// Thin UAZAPI proxy: load the account's uazapi row (provider-filtered —
// 404 otherwise), decrypt the instance token, call configureWebhook,
// then UPDATE webhook_secret_hash + clear last_connection_error.
// Responds with { data: toConnectionDTO(fresh ?? {}) }.
//
// Shape mirrors src/app/api/whatsapp/connections/[id]/connect/route.test.ts: a
// chainable Supabase mock via vi.mock('@/lib/supabase/server') plus a
// `callerRole` toggle that feeds requireRole through the
// profiles/accounts selects.
// ---------------------------------------------------------------------------

let callerRole = 'admin';
// The row loadUazapiConnectionRow() resolves to (null → 404).
let loadRowResult: Record<string, unknown> | null = null;

// Every whatsapp_connections UPDATE in call order, with its chained filters.
const updateCalls: Array<{
  payload: Record<string, unknown>;
  filters: unknown[][];
}> = [];

function makeSupabaseMock() {
  function builder(table: string) {
    let didUpdate = false;
    const b: Record<string, unknown> = {};
    b._filters = [] as unknown[][];
    b._select = undefined as unknown;

    const connRead = () => {
      if (typeof b._select === 'string' && b._select.includes('credential')) {
        return { data: loadRowResult, error: null };
      }
      return { data: null, error: null };
    };

    const result = (kind: 'single' | 'maybeSingle' | 'await') => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          };
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null };
        case 'whatsapp_connections':
          if (didUpdate) {
            void kind;
            return { data: null, error: null };
          }
          return connRead();
        default:
          return { data: null, error: null };
      }
    };

    const chain = () => b;
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'neq']) {
      b[m] = vi.fn((...args: unknown[]) => {
        (b._filters as unknown[][]).push([m, ...args]);
        if (m === 'select') b._select = args[0];
        return chain();
      });
    }
    b.update = vi.fn((payload: Record<string, unknown>) => {
      didUpdate = true;
      if (table === 'whatsapp_connections') {
        updateCalls.push({ payload, filters: b._filters as unknown[][] });
      }
      return b;
    });
    b.single = vi.fn(() => Promise.resolve(result('single')));
    b.maybeSingle = vi.fn(() => Promise.resolve(result('maybeSingle')));
    b.then = (resolve: (v: unknown) => unknown) => resolve(result('await'));
    return b;
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  };
}

let supabaseMock = makeSupabaseMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

const { configureWebhook, loadUazapiConnectionRow } = vi.hoisted(() => ({
  configureWebhook: vi.fn(async () => undefined),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadUazapiConnectionRow: vi.fn(async (_db: SupabaseClient, _accountId: string, _id: string) => loadRowResult),
}));
vi.mock('@/lib/whatsapp/uazapi-admin', () => ({
  configureWebhook,
}));

vi.mock('@/lib/whatsapp/uazapi-connection-row', () => ({
  loadUazapiConnectionRow,
}));

vi.mock('@/lib/whatsapp/uazapi-env', () => ({
  uazapiEnv: () => ({
    baseUrl: 'https://api.uazapi.com',
    adminToken: 'admin-tok',
  }),
  resolveAppBaseUrl: () => 'https://crm.example.com',
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
}));

import { POST } from './route';

function reconfigureRequest() {
  return new Request(
    'http://localhost/api/whatsapp/connections/conn-1/reconfigure-webhook',
    { method: 'POST' }
  );
}

const params = Promise.resolve({ id: 'conn-1' });

beforeEach(() => {
  callerRole = 'admin';
  loadRowResult = {
    id: 'conn-1',
    provider: 'uazapi',
    is_primary: false,
    status: 'connected',
    credential: 'enc-cred',
    // Distinct from the env base URL so the test proves the route pins
    // the per-connection value, not uazapiEnv().baseUrl (FIX 5).
    uazapi_base_url: 'https://pinned.uazapi.example',
    uazapi_instance_id: 'inst-1',
  };
  updateCalls.length = 0;
  supabaseMock = makeSupabaseMock();
  configureWebhook.mockClear();
  configureWebhook.mockResolvedValue(undefined);
  loadUazapiConnectionRow.mockClear();
  loadUazapiConnectionRow.mockImplementation(async () => loadRowResult);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('POST /api/whatsapp/connections/[id]/reconfigure-webhook', () => {
  it('403s a non-admin caller (agent)', async () => {
    callerRole = 'agent';

    const res = await POST(reconfigureRequest(), { params });

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
    expect(configureWebhook).not.toHaveBeenCalled();
  });

  it('404s when the row does not load for the account', async () => {
    loadRowResult = null;

    const res = await POST(reconfigureRequest(), { params });

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
    expect(configureWebhook).not.toHaveBeenCalled();
  });

  it('404s when the row has no uazapi_base_url', async () => {
    loadRowResult = { ...(loadRowResult as object), uazapi_base_url: null };

    const res = await POST(reconfigureRequest(), { params });

    expect(res.status).toBe(404);
    expect(configureWebhook).not.toHaveBeenCalled();
  });

  it('happy path: re-registers the webhook, updates webhook_secret_hash, clears last_connection_error, returns 200 with { data }', async () => {
    const res = await POST(reconfigureRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);

    // configureWebhook called with the pinned base URL and a URL ending in /api/whatsapp/webhook/uazapi/<64 hex>
    expect(configureWebhook).toHaveBeenCalledTimes(1);
    const [wBase, wToken, wUrl] = configureWebhook.mock.calls[0] as string[];
    expect(wBase).toBe('https://pinned.uazapi.example');
    expect(wToken).toBe('plaintext-token');
    expect(wUrl).toMatch(
      /^https:\/\/crm\.example\.com\/api\/whatsapp\/webhook\/uazapi\/[0-9a-f]{64}$/
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.webhook_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(updateCalls[0].payload.last_connection_error).toBeNull();
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);
    expect(updateCalls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);

    expect(json).toEqual({
      data: expect.any(Object),
    });
    expect(json.data).not.toHaveProperty('webhook_secret_hash');
    expect(json.data).not.toHaveProperty('credential');
  });

  it('configureWebhook throwing → last_connection_error written + 502', async () => {
    configureWebhook.mockRejectedValueOnce(new Error('webhook down'));

    const res = await POST(reconfigureRequest(), { params });

    expect(res.status).toBe(502);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.last_connection_error).toEqual(
      'Webhook não configurado — tente de novo.'
    );
    // The hash is NOT persisted on failure.
    expect(updateCalls[0].payload).not.toHaveProperty('webhook_secret_hash');
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);
    expect(updateCalls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);
  });

  it('404s when the id belongs to another account', async () => {
    // Set up a row that belongs to a different account. The route will call
    // loadUazapiConnectionRow(supabase, accountId, id) where accountId comes
    // from requireRole (caller's account). We verify:
    // 1. loadUazapiConnectionRow is called with the caller's account_id ('acct-1')
    // 2. It returns null (row filtered out by account)
    // 3. The route 404s and touches no other operations.
    const rowFromOtherAccount = {
      id: 'conn-1',
      provider: 'uazapi',
      status: 'connected',
      account_id: 'acct-2', // Different account
      credential: 'enc-cred',
      uazapi_base_url: 'https://pinned.uazapi.example',
      uazapi_instance_id: 'inst-1',
    };

    // Mock loadUazapiConnectionRow to simulate filtering: if the caller's
    // account_id doesn't match the row's account_id, return null.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    loadUazapiConnectionRow.mockImplementation(async (_db: SupabaseClient, callerAccountId: string, _id: string) => {
      if (callerAccountId === rowFromOtherAccount.account_id) {
        return rowFromOtherAccount;
      }
      return null; // No row found for this caller's account.
    });

    const res = await POST(reconfigureRequest(), { params });

    // Assert the route passed the caller's account_id to loadUazapiConnectionRow.
    expect(loadUazapiConnectionRow).toHaveBeenCalledWith(
      supabaseMock,
      'acct-1', // Caller's account from requireRole, not from params
      'conn-1'
    );

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
    expect(configureWebhook).not.toHaveBeenCalled();
  });
});
