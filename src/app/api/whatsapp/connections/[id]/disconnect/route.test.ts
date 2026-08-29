import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for POST /api/whatsapp/connections/[id]/disconnect.
//
// Thin UAZAPI proxy: load the account's uazapi row (provider-filtered —
// 404 otherwise), best-effort disconnectInstance (a rejection is logged,
// never blocks), then UPDATE status='disconnected' and return the fresh
// row as a ConnectionDTO.
// ---------------------------------------------------------------------------

let callerRole = 'admin';
let loadRowResult: Record<string, unknown> | null = null;
let freshRow: Record<string, unknown> | null = null;

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
            if (kind === 'single') return { data: freshRow, error: null };
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

const { disconnectInstance } = vi.hoisted(() => ({
  disconnectInstance: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/uazapi-admin', () => ({ disconnectInstance }));

vi.mock('@/lib/whatsapp/uazapi-env', () => ({
  uazapiEnv: () => ({
    baseUrl: 'https://api.uazapi.com',
    adminToken: 'admin-tok',
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
}));

import { POST } from './route';

function disconnectRequest() {
  return new Request(
    'http://localhost/api/whatsapp/connections/conn-1/disconnect',
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
    uazapi_base_url: 'https://api.uazapi.com',
    uazapi_instance_id: 'inst-1',
  };
  freshRow = {
    id: 'conn-1',
    provider: 'uazapi',
    label: null,
    status: 'disconnected',
    is_primary: false,
    display_phone: null,
    profile_name: null,
    last_connection_error: null,
    created_at: '2026-08-01T00:00:00Z',
  };
  updateCalls.length = 0;
  supabaseMock = makeSupabaseMock();
  disconnectInstance.mockClear();
  disconnectInstance.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('POST /api/whatsapp/connections/[id]/disconnect', () => {
  it('403s a non-admin caller (agent)', async () => {
    callerRole = 'agent';

    const res = await POST(disconnectRequest(), { params });

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
    expect(disconnectInstance).not.toHaveBeenCalled();
  });

  it('404s when the row does not load for the account', async () => {
    loadRowResult = null;

    const res = await POST(disconnectRequest(), { params });

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
    expect(disconnectInstance).not.toHaveBeenCalled();
  });

  it('404s when the row has no uazapi_base_url', async () => {
    loadRowResult = { ...(loadRowResult as object), uazapi_base_url: null };

    const res = await POST(disconnectRequest(), { params });

    expect(res.status).toBe(404);
    expect(disconnectInstance).not.toHaveBeenCalled();
  });

  it('happy path: disconnects remote, persists status=disconnected, returns the DTO', async () => {
    const res = await POST(disconnectRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);

    expect(disconnectInstance).toHaveBeenCalledWith(
      'https://api.uazapi.com',
      'plaintext-token'
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ status: 'disconnected' });
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);
    expect(updateCalls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);

    expect(Object.keys(json.data).sort()).toEqual([
      'created_at',
      'display_phone',
      'id',
      'is_primary',
      'label',
      'last_connection_error',
      'profile_name',
      'provider',
      'status',
    ]);
    expect(json.data.status).toBe('disconnected');
  });

  it('a rejecting disconnectInstance does NOT block the archive', async () => {
    disconnectInstance.mockRejectedValueOnce(new Error('remote boom'));

    const res = await POST(disconnectRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ status: 'disconnected' });
  });
});
