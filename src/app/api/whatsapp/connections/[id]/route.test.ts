import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for PATCH | DELETE /api/whatsapp/connections/[id].
//
// PATCH  — mutates label / is_primary / mirror_inbound_media on ONE
//          connection (any provider) by id. Promoting a connection to
//          primary sets is_primary=true on the target row FIRST, then a
//          second UPDATE clears is_primary on every other active row —
//          the reverse order would leave the account with 0 primaries and
//          break a concurrent send. Demoting the sole active connection is
//          refused with 400.
//
// DELETE  — archives a connection: for uazapi rows it best-effort
//          disconnects and deletes the remote instance (a failure there is
//          logged, never blocks), then stamps archived_at / status /
//          is_primary. If the archived row was primary and exactly one
//          active row remains, that row inherits primary.
//
// Shape mirrors src/app/api/whatsapp/connections/route.test.ts: a
// chainable Supabase mock via vi.mock('@/lib/supabase/server') plus a
// `callerRole` toggle that feeds requireRole through the
// profiles/accounts selects.
// ---------------------------------------------------------------------------

// Per-test scenario toggles.
let callerRole = 'admin';
// The row loadRow() resolves to (null → 404). Shape: RowLite.
let loadRowResult: Record<string, unknown> | null = null;
// activeCount() result — drives the is_primary:false sole-connection 400.
let activeCountValue = 2;
// Rows the DELETE primary-reassignment "remaining active" select returns.
let remainingRows: Array<Record<string, unknown>> = [];
// The row the PATCH fresh re-select resolves to.
let freshRow: Record<string, unknown> | null = null;
// The row the DELETE archive UPDATE ... select().single() resolves to.
let archivedRow: Record<string, unknown> | null = null;
// Forced error from an UPDATE terminal.
let updateError: { message: string } | null = null;

// Captures: every whatsapp_connections UPDATE in call order, each with the
// filters chained after it.
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
    b._selectHasCount = false;

    const connRead = () => {
      if (typeof b._select === 'string' && b._select.includes('credential')) {
        return { data: loadRowResult, error: null };
      }
      if (b._select === 'id') {
        return { data: remainingRows, error: null };
      }
      return { data: freshRow, error: null };
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
          if (b._selectHasCount) {
            return { count: activeCountValue, error: null };
          }
          if (didUpdate) {
            if (kind === 'single') {
              return { data: archivedRow, error: updateError };
            }
            return { data: null, error: updateError };
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
        if (m === 'select') {
          b._select = args[0];
          const opts = args[1];
          b._selectHasCount =
            !!opts && typeof opts === 'object' && 'count' in opts;
        }
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

const { disconnectInstance, deleteInstance } = vi.hoisted(() => ({
  disconnectInstance: vi.fn(async () => undefined),
  deleteInstance: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/uazapi-admin', () => ({
  disconnectInstance,
  deleteInstance,
}));

vi.mock('@/lib/whatsapp/uazapi-env', () => ({
  uazapiEnv: () => ({
    baseUrl: 'https://api.uazapi.com',
    adminToken: 'admin-tok',
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
}));

import { PATCH, DELETE } from './route';

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/whatsapp/connections/conn-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new Request('http://localhost/api/whatsapp/connections/conn-1', {
    method: 'DELETE',
  });
}

const params = Promise.resolve({ id: 'conn-1' });

beforeEach(() => {
  callerRole = 'admin';
  loadRowResult = {
    id: 'conn-1',
    provider: 'uazapi',
    is_primary: false,
    credential: 'enc-cred',
    uazapi_base_url: 'https://api.uazapi.com',
  };
  activeCountValue = 2;
  remainingRows = [];
  freshRow = {
    id: 'conn-1',
    provider: 'uazapi',
    label: null,
    status: 'connected',
    is_primary: false,
    display_phone: null,
    profile_name: null,
    last_connection_error: null,
    created_at: '2026-08-01T00:00:00Z',
  };
  archivedRow = {
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
  updateError = null;
  updateCalls.length = 0;
  supabaseMock = makeSupabaseMock();
  disconnectInstance.mockClear();
  deleteInstance.mockClear();
  disconnectInstance.mockResolvedValue(undefined);
  deleteInstance.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('common', () => {
  it('403s a non-admin caller (agent) — PATCH', async () => {
    callerRole = 'agent';

    const res = await PATCH(patchRequest({ label: 'x' }), { params });

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
  });

  it('403s a non-admin caller (agent) — DELETE', async () => {
    callerRole = 'agent';

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
  });

  it('404s PATCH when the row does not load for the account', async () => {
    loadRowResult = null;

    const res = await PATCH(patchRequest({ label: 'x' }), { params });

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });

  it('404s DELETE when the row does not load for the account', async () => {
    loadRowResult = null;

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
    expect(deleteInstance).not.toHaveBeenCalled();
  });
});

describe('PATCH', () => {
  it('writes label and returns the DTO', async () => {
    freshRow = { ...(freshRow as Record<string, unknown>), label: 'New label' };

    const res = await PATCH(patchRequest({ label: 'New label' }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ label: 'New label' });
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);
    expect(json.data.label).toBe('New label');
    // Response is the 9-key ConnectionDTO, no credential.
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
  });

  it('writes the mirror_inbound_media column', async () => {
    const res = await PATCH(patchRequest({ mirror_inbound_media: true }), {
      params,
    });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ mirror_inbound_media: true });
  });

  it('accepts a PATCH against a meta-provider row', async () => {
    loadRowResult = {
      id: 'conn-1',
      provider: 'meta',
      is_primary: false,
      credential: 'enc-cred',
      uazapi_base_url: null,
    };

    const res = await PATCH(patchRequest({ mirror_inbound_media: false }), {
      params,
    });

    expect(res.status).toBe(200);
    expect(updateCalls[0].payload).toEqual({ mirror_inbound_media: false });
  });

  it('is_primary:true → sets the target row primary FIRST, then clears the others', async () => {
    const res = await PATCH(patchRequest({ is_primary: true }), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(2);

    // 1st UPDATE: promote the target id.
    expect(updateCalls[0].payload).toEqual({ is_primary: true });
    expect(updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1']);

    // 2nd UPDATE: demote every other active row.
    expect(updateCalls[1].payload).toEqual({ is_primary: false });
    expect(updateCalls[1].filters).toContainEqual(['neq', 'id', 'conn-1']);
    expect(updateCalls[1].filters).toContainEqual(['is', 'archived_at', null]);
  });

  it('is_primary:false on the only active connection → 400, no write', async () => {
    activeCountValue = 1;

    const res = await PATCH(patchRequest({ is_primary: false }), { params });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/default channel/i);
    expect(updateCalls).toHaveLength(0);
  });

  it('is_primary:false with 2+ active connections → writes false', async () => {
    activeCountValue = 2;

    const res = await PATCH(patchRequest({ is_primary: false }), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ is_primary: false });
  });
});

describe('DELETE', () => {
  it('uazapi row: disconnects + deletes the remote instance with the decrypted token, then archives', async () => {
    const res = await DELETE(deleteRequest(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);

    expect(disconnectInstance).toHaveBeenCalledWith(
      'https://api.uazapi.com',
      'plaintext-token'
    );
    expect(deleteInstance).toHaveBeenCalledWith(
      'https://api.uazapi.com',
      'plaintext-token'
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({
      status: 'disconnected',
      is_primary: false,
    });
    expect(typeof updateCalls[0].payload.archived_at).toBe('string');

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
  });

  it('does not touch the remote instance for a meta-provider row', async () => {
    loadRowResult = {
      id: 'conn-1',
      provider: 'meta',
      is_primary: false,
      credential: 'enc-cred',
      uazapi_base_url: null,
    };

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(200);
    expect(disconnectInstance).not.toHaveBeenCalled();
    expect(deleteInstance).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(1);
  });

  it('primary re-assignment: archived row was primary and exactly one active row remains → that row inherits', async () => {
    loadRowResult = {
      id: 'conn-1',
      provider: 'uazapi',
      is_primary: true,
      credential: 'enc-cred',
      uazapi_base_url: 'https://api.uazapi.com',
    };
    remainingRows = [{ id: 'conn-2' }];

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(2);
    // 1st: the archive. 2nd: promote the survivor.
    expect(updateCalls[1].payload).toEqual({ is_primary: true });
    expect(updateCalls[1].filters).toContainEqual(['eq', 'id', 'conn-2']);
  });

  it('no re-assignment when 2+ active rows remain', async () => {
    loadRowResult = {
      id: 'conn-1',
      provider: 'uazapi',
      is_primary: true,
      credential: 'enc-cred',
      uazapi_base_url: 'https://api.uazapi.com',
    };
    remainingRows = [{ id: 'conn-2' }, { id: 'conn-3' }];

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
  });

  it('no re-assignment when 0 active rows remain', async () => {
    loadRowResult = {
      id: 'conn-1',
      provider: 'uazapi',
      is_primary: true,
      credential: 'enc-cred',
      uazapi_base_url: 'https://api.uazapi.com',
    };
    remainingRows = [];

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
  });

  it('deleteInstance rejecting does NOT block the archive', async () => {
    deleteInstance.mockRejectedValueOnce(new Error('quota boom'));

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({ status: 'disconnected' });
  });
});
