import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for POST /api/whatsapp/connections/[id]/connect.
//
// Thin UAZAPI proxy: load the account's uazapi row (provider-filtered —
// 404 otherwise), decrypt the instance token, call connectInstance, then
// UPDATE status='connecting' + clear last_connection_error. Responds with
// { qrcode, paircode, expiresInSeconds: 120 }.
//
// Shape mirrors src/app/api/whatsapp/connections/[id]/route.test.ts: a
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

const { connectInstance, configureWebhook } = vi.hoisted(() => ({
  connectInstance: vi.fn(
    async (): Promise<{
      qrcode: string | null;
      paircode: string | null;
    }> => ({ qrcode: 'qr-data', paircode: 'PAIR12' })
  ),
  configureWebhook: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/uazapi-admin', () => ({
  connectInstance,
  configureWebhook,
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

function connectRequest() {
  return new Request(
    'http://localhost/api/whatsapp/connections/conn-1/connect',
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
    status: 'disconnected',
    credential: 'enc-cred',
    // Distinct from the env base URL so the test proves the route pins
    // the per-connection value, not uazapiEnv().baseUrl (FIX 5).
    uazapi_base_url: 'https://pinned.uazapi.example',
    uazapi_instance_id: 'inst-1',
  };
  updateCalls.length = 0;
  supabaseMock = makeSupabaseMock();
  connectInstance.mockClear();
  connectInstance.mockResolvedValue({ qrcode: 'qr-data', paircode: 'PAIR12' });
  configureWebhook.mockClear();
  configureWebhook.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('POST /api/whatsapp/connections/[id]/connect', () => {
  it('403s a non-admin caller (agent)', async () => {
    callerRole = 'agent';

    const res = await POST(connectRequest(), { params });

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
    expect(connectInstance).not.toHaveBeenCalled();
    expect(configureWebhook).not.toHaveBeenCalled();
  });

  it('404s when the row does not load for the account', async () => {
    loadRowResult = null;

    const res = await POST(connectRequest(), { params });

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
    expect(connectInstance).not.toHaveBeenCalled();
  });

  it('404s when the row has no uazapi_base_url', async () => {
    loadRowResult = { ...(loadRowResult as object), uazapi_base_url: null };

    const res = await POST(connectRequest(), { params });

    expect(res.status).toBe(404);
    expect(connectInstance).not.toHaveBeenCalled();
  });

  it('happy path: connects via the pinned base URL, re-registers the webhook, persists status=connecting + fresh hash', async () => {
    const res = await POST(connectRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);

    // FIX 5: the UAZAPI admin call uses row.uazapi_base_url, NOT the env.
    expect(connectInstance).toHaveBeenCalledWith(
      'https://pinned.uazapi.example',
      'plaintext-token'
    );

    // FIX 3: webhook re-registered against the pinned base + app origin.
    expect(configureWebhook).toHaveBeenCalledTimes(1);
    const [wBase, wToken, wUrl] = configureWebhook.mock.calls[0] as string[];
    expect(wBase).toBe('https://pinned.uazapi.example');
    expect(wToken).toBe('plaintext-token');
    expect(wUrl).toMatch(
      /^https:\/\/crm\.example\.com\/api\/whatsapp\/webhook\/uazapi\/[0-9a-f]{64}$/
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.status).toBe('connecting');
    expect(updateCalls[0].payload.last_connection_error).toBeNull();
    expect(updateCalls[0].payload.webhook_secret_hash).toMatch(
      /^[0-9a-f]{64}$/
    );
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);
    expect(updateCalls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);

    expect(json).toEqual({
      qrcode: 'qr-data',
      paircode: 'PAIR12',
      expiresInSeconds: 120,
    });
  });

  it('configureWebhook throwing is non-fatal: still 200 with the QR, UPDATE records a webhook error', async () => {
    configureWebhook.mockRejectedValueOnce(new Error('webhook down'));

    const res = await POST(connectRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      qrcode: 'qr-data',
      paircode: 'PAIR12',
      expiresInSeconds: 120,
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.status).toBe('connecting');
    expect(updateCalls[0].payload.last_connection_error).toEqual(
      expect.stringMatching(/webhook/i)
    );
    // The new hash is only persisted once UAZAPI actually has the secret.
    expect(updateCalls[0].payload).not.toHaveProperty('webhook_secret_hash');
  });

  it('passes through null qrcode/paircode from the client', async () => {
    connectInstance.mockResolvedValueOnce({ qrcode: null, paircode: null });

    const res = await POST(connectRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      qrcode: null,
      paircode: null,
      expiresInSeconds: 120,
    });
  });
});
