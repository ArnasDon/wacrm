import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for GET /api/whatsapp/connections/[id]/status.
//
// Thin UAZAPI proxy: load the account's uazapi row (provider-filtered —
// 404 otherwise), decrypt the token, call instanceStatus, then persist
// the mapping:
//   connected  → UPDATE status='connected' + display_phone + profile_name
//                + last_connection_error=null
//   otherwise  → UPDATE status = whitelisted(st.instanceStatus) ?? 'disconnected'
//                (whitelist mirrors migration 040's CHECK; a failing
//                 UPDATE now 500s instead of a silent 200)
// Response: { status, display_phone, profile_name, qrcode } (phone/name
// only when connected; qrcode passed straight through).
// ---------------------------------------------------------------------------

let callerRole = 'admin';
let loadRowResult: Record<string, unknown> | null = null;
let statusResult: Record<string, unknown> = {};
// Forced error from the persist UPDATE terminal (drives the 500 path).
let forcedUpdateError: { message: string } | null = null;

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
            return { data: null, error: forcedUpdateError };
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

const { instanceStatus } = vi.hoisted(() => ({
  instanceStatus: vi.fn(async () => ({}) as Record<string, unknown>),
}));
vi.mock('@/lib/whatsapp/uazapi-admin', () => ({ instanceStatus }));

vi.mock('@/lib/whatsapp/uazapi-env', () => ({
  uazapiEnv: () => ({
    baseUrl: 'https://api.uazapi.com',
    adminToken: 'admin-tok',
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
}));

import { GET } from './route';

function statusRequest() {
  return new Request(
    'http://localhost/api/whatsapp/connections/conn-1/status',
    { method: 'GET' }
  );
}

const params = Promise.resolve({ id: 'conn-1' });

beforeEach(() => {
  callerRole = 'admin';
  loadRowResult = {
    id: 'conn-1',
    provider: 'uazapi',
    is_primary: false,
    status: 'connecting',
    credential: 'enc-cred',
    // Distinct from the env base URL so the test proves the route pins
    // the per-connection value, not uazapiEnv().baseUrl (FIX 5).
    uazapi_base_url: 'https://pinned.uazapi.example',
    uazapi_instance_id: 'inst-1',
  };
  forcedUpdateError = null;
  statusResult = {
    connected: false,
    loggedIn: false,
    phone: null,
    profileName: null,
    instanceStatus: 'connecting',
    qrcode: 'qr-xyz',
  };
  updateCalls.length = 0;
  supabaseMock = makeSupabaseMock();
  instanceStatus.mockClear();
  instanceStatus.mockImplementation(async () => statusResult);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GET /api/whatsapp/connections/[id]/status', () => {
  it('403s a non-admin caller (agent)', async () => {
    callerRole = 'agent';

    const res = await GET(statusRequest(), { params });

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
    expect(instanceStatus).not.toHaveBeenCalled();
  });

  it('404s when the row does not load for the account', async () => {
    loadRowResult = null;

    const res = await GET(statusRequest(), { params });

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
    expect(instanceStatus).not.toHaveBeenCalled();
  });

  it('404s when the row has no uazapi_base_url', async () => {
    loadRowResult = { ...(loadRowResult as object), uazapi_base_url: null };

    const res = await GET(statusRequest(), { params });

    expect(res.status).toBe(404);
    expect(instanceStatus).not.toHaveBeenCalled();
  });

  it('connected: persists phone/name + clears error, echoes them back', async () => {
    statusResult = {
      connected: true,
      loggedIn: true,
      phone: '5511999998888',
      profileName: 'Ada Lovelace',
      instanceStatus: 'connected',
      qrcode: null,
    };

    const res = await GET(statusRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(instanceStatus).toHaveBeenCalledWith(
      'https://pinned.uazapi.example',
      'plaintext-token'
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({
      status: 'connected',
      display_phone: '5511999998888',
      profile_name: 'Ada Lovelace',
      last_connection_error: null,
    });
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);
    expect(updateCalls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);

    expect(json).toEqual({
      status: 'connected',
      display_phone: '5511999998888',
      profile_name: 'Ada Lovelace',
      qrcode: null,
    });
  });

  it('not connected: persists instanceStatus, nulls phone/name in the response, passes qrcode through', async () => {
    statusResult = {
      connected: false,
      loggedIn: false,
      phone: null,
      profileName: null,
      instanceStatus: 'connecting',
      qrcode: 'qr-xyz',
    };

    const res = await GET(statusRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ status: 'connecting' });

    expect(json).toEqual({
      status: 'connecting',
      display_phone: null,
      profile_name: null,
      qrcode: 'qr-xyz',
    });
  });

  it('not connected with a null instanceStatus falls back to disconnected', async () => {
    statusResult = {
      connected: false,
      loggedIn: false,
      phone: null,
      profileName: null,
      instanceStatus: null,
      qrcode: null,
    };

    const res = await GET(statusRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(updateCalls[0].payload).toEqual({ status: 'disconnected' });
    expect(json.status).toBe('disconnected');
  });

  it('an unexpected instanceStatus is whitelisted down to disconnected (FIX 7)', async () => {
    statusResult = {
      connected: false,
      loggedIn: false,
      phone: null,
      profileName: null,
      instanceStatus: 'weird_new_value',
      qrcode: 'qr-xyz',
    };

    const res = await GET(statusRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    // Never persists a value outside migration 040's CHECK.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ status: 'disconnected' });
    expect(json).toEqual({
      status: 'disconnected',
      display_phone: null,
      profile_name: null,
      qrcode: 'qr-xyz',
    });
  });

  it('a failing persist UPDATE surfaces as 500, not a silent 200 (FIX 7)', async () => {
    forcedUpdateError = { message: '23514 check violation' };

    const res = await GET(statusRequest(), { params });

    expect(res.status).toBe(500);
  });
});
