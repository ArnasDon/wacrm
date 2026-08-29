import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for GET | POST /api/whatsapp/connections.
//
// GET  — lists the account's non-archived connections (both providers) as
//        ConnectionDTO[], never leaking the encrypted credential. Gated at
//        requireRole('agent') — read-only + sanitized (FIX 6); every
//        mutation stays admin-gated.
// POST — provisions one UAZAPI connection: dedupe (409) → createInstance →
//        secret + sha256 hash → is_primary election by active-connection
//        count (FIX 2) → INSERT → configureWebhook. Rolls the instance
//        back on a failing count query or INSERT failure (502); a webhook
//        failure is non-fatal (row kept, last_connection_error, still 201).
//
// Shape mirrors src/app/api/whatsapp/send/route.test.ts: a chainable
// Supabase mock via vi.mock('@/lib/supabase/server') plus a `callerRole`
// toggle that feeds requireRole through the profiles/accounts selects.
// ---------------------------------------------------------------------------

// Per-test scenario toggles.
let callerRole = 'admin';
// The pre-existing uazapi row the 409 dedupe check finds (null = none).
let existingUazapiRow: Record<string, unknown> | null = null;
// Forced error from the INSERT terminal (drives the rollback path).
let insertError: { message: string } | null = null;
// Result of the is_primary-election count query (FIX 2).
let activeConnCount = 0;
// Forced error from that count query (drives the 502 rollback path).
let countError: { message: string } | null = null;
// Rows the GET select resolves to (raw DB rows, credential included).
let connectionRows: Array<Record<string, unknown>> = [];

// Captures of what the route wrote / how it queried.
const insertPayloads: Array<Record<string, unknown>> = [];
const updatePayloads: Array<Record<string, unknown>> = [];
const orderCalls: unknown[][] = [];
const isCalls: unknown[][] = [];

// The row the INSERT ... select().single() resolves to on success.
const INSERTED_ROW = {
  id: 'conn-new',
  provider: 'uazapi',
  label: null,
  status: 'disconnected',
  is_primary: false,
  display_phone: null,
  profile_name: null,
  last_connection_error: null,
  created_at: '2026-08-29T12:00:00Z',
};

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false;
    let didUpdate = false;

    const connResult = () => {
      if (didInsert) {
        return { data: insertError ? null : INSERTED_ROW, error: insertError };
      }
      if (didUpdate) {
        return { data: null, error: null };
      }
      // The is_primary-election count query (FIX 2): select('id', {
      // count: 'exact', head: true }) before any insert/update.
      if (b._selectCount) {
        return { count: activeConnCount, error: countError };
      }
      return { data: connectionRows, error: null };
    };

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          };
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null };
        case 'whatsapp_connections':
          return connResult();
        default:
          return { data: null, error: null };
      }
    };

    // Pre-insert maybeSingle on whatsapp_connections === the 409 dedupe check.
    const maybeSingleResult = () => {
      if (table === 'whatsapp_connections' && !didInsert) {
        return { data: existingUazapiRow, error: null };
      }
      return selectResult();
    };

    const b: Record<string, unknown> = {};
    b._selectCount = false;
    const chain = () => b;
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is']) {
      b[m] = vi.fn((...args: unknown[]) => {
        if (m === 'order') orderCalls.push(args);
        if (m === 'is') isCalls.push(args);
        if (m === 'select') {
          const opts = args[1];
          b._selectCount =
            !!opts && typeof opts === 'object' && 'count' in opts;
        }
        return chain();
      });
    }
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true;
      if (table === 'whatsapp_connections') insertPayloads.push(payload);
      return b;
    });
    b.update = vi.fn((payload: Record<string, unknown>) => {
      didUpdate = true;
      if (table === 'whatsapp_connections') updatePayloads.push(payload);
      return b;
    });
    b.single = vi.fn(() => Promise.resolve(selectResult()));
    b.maybeSingle = vi.fn(() => Promise.resolve(maybeSingleResult()));
    b.then = (resolve: (v: unknown) => unknown) => resolve(selectResult());
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

const { createInstance, configureWebhook, deleteInstance } = vi.hoisted(() => ({
  createInstance: vi.fn(async () => ({
    token: 'inst-token',
    instanceId: 'inst-id',
  })),
  configureWebhook: vi.fn(async () => undefined),
  deleteInstance: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/uazapi-admin', () => ({
  createInstance,
  configureWebhook,
  deleteInstance,
}));

vi.mock('@/lib/whatsapp/uazapi-env', () => ({
  uazapiEnv: () => ({
    baseUrl: 'https://api.uazapi.com',
    adminToken: 'admin-tok',
  }),
  resolveAppBaseUrl: () => 'https://crm.example.com',
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn((s: string) => `enc(${s})`),
}));

import { GET, POST } from './route';

function postRequest() {
  return new Request('http://localhost/api/whatsapp/connections', {
    method: 'POST',
  });
}

beforeEach(() => {
  callerRole = 'admin';
  existingUazapiRow = null;
  insertError = null;
  activeConnCount = 0;
  countError = null;
  connectionRows = [];
  insertPayloads.length = 0;
  updatePayloads.length = 0;
  orderCalls.length = 0;
  isCalls.length = 0;
  supabaseMock = makeSupabaseMock();
  createInstance.mockClear();
  configureWebhook.mockClear();
  deleteInstance.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/whatsapp/connections', () => {
  it('200s for an agent caller — the list is read-only + sanitized (FIX 6)', async () => {
    callerRole = 'agent';

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  it('403s a viewer caller (below agent)', async () => {
    callerRole = 'viewer';

    const res = await GET();

    expect(res.status).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('whatsapp_connections');
  });

  it('returns the account non-archived rows as ConnectionDTO[] without credential', async () => {
    connectionRows = [
      {
        id: 'conn-meta',
        provider: 'meta',
        label: 'Main line',
        status: 'connected',
        is_primary: true,
        display_phone: '5511000000000',
        profile_name: 'Meta Biz',
        last_connection_error: null,
        created_at: '2026-08-01T00:00:00Z',
        credential: 'enc-meta-secret',
        phone_number_id: 'PN-META',
      },
      {
        id: 'conn-uazapi',
        provider: 'uazapi',
        label: null,
        status: 'disconnected',
        is_primary: false,
        display_phone: null,
        profile_name: null,
        last_connection_error: 'boom',
        created_at: '2026-08-15T00:00:00Z',
        credential: 'enc-uazapi-secret',
        uazapi_instance_id: 'inst-xyz',
      },
    ];

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toEqual({
      id: 'conn-meta',
      provider: 'meta',
      label: 'Main line',
      status: 'connected',
      is_primary: true,
      display_phone: '5511000000000',
      profile_name: 'Meta Biz',
      last_connection_error: null,
      created_at: '2026-08-01T00:00:00Z',
    });
    expect(json.data[1].provider).toBe('uazapi');

    // No sensitive field survives the projection.
    const serialized = JSON.stringify(json.data);
    expect(serialized).not.toContain('enc-meta-secret');
    expect(serialized).not.toContain('enc-uazapi-secret');
    expect(serialized).not.toContain('inst-xyz');
    expect(serialized).not.toContain('PN-META');

    // Non-archived filter + created_at asc ordering.
    expect(isCalls).toContainEqual(['archived_at', null]);
    expect(orderCalls).toContainEqual(['created_at', { ascending: true }]);
  });
});

describe('POST /api/whatsapp/connections', () => {
  it('403s a non-admin caller (agent)', async () => {
    callerRole = 'agent';

    const res = await POST(postRequest());

    expect(res.status).toBe(403);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('409s when a non-archived uazapi row already exists', async () => {
    existingUazapiRow = { id: 'conn-existing' };

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already has a uazapi connection/i);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('happy path: fresh account → the new row is elected is_primary, webhook registered, 201 (FIX 2)', async () => {
    activeConnCount = 0;

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(201);

    // createInstance called with base url, admin token, wacrm-<accountId>.
    expect(createInstance).toHaveBeenCalledWith(
      'https://api.uazapi.com',
      'admin-tok',
      'wacrm-acct-1'
    );

    // The INSERT payload.
    expect(insertPayloads).toHaveLength(1);
    const payload = insertPayloads[0];
    expect(payload.provider).toBe('uazapi');
    expect(payload.credential).toBe('enc(inst-token)');
    expect(payload.uazapi_instance_id).toBe('inst-id');
    expect(payload.uazapi_base_url).toBe('https://api.uazapi.com');
    expect(payload.status).toBe('disconnected');
    // First-and-only connection (incl. a UAZAPI-only account) → primary.
    expect(payload.is_primary).toBe(true);
    expect(payload.webhook_secret_hash).toMatch(/^[0-9a-f]{64}$/);

    // configureWebhook url ends with /api/whatsapp/webhook/uazapi/<64 hex>.
    expect(configureWebhook).toHaveBeenCalledTimes(1);
    const [wBase, wToken, wUrl] = configureWebhook.mock.calls[0] as string[];
    expect(wBase).toBe('https://api.uazapi.com');
    expect(wToken).toBe('inst-token');
    expect(wUrl).toMatch(/\/api\/whatsapp\/webhook\/uazapi\/[0-9a-f]{64}$/);

    // The response is the ConnectionDTO (9 keys, no credential).
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
    expect(json.data.id).toBe('conn-new');
    expect(deleteInstance).not.toHaveBeenCalled();
  });

  it('an account that already has an active connection → the new row is born non-primary (FIX 2)', async () => {
    activeConnCount = 1;

    const res = await POST(postRequest());

    expect(res.status).toBe(201);
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0].is_primary).toBe(false);
  });

  it('a failing election count query rolls the instance back and 502s (FIX 2)', async () => {
    countError = { message: 'count boom' };

    const res = await POST(postRequest());

    expect(res.status).toBe(502);
    expect(insertPayloads).toHaveLength(0);
    expect(deleteInstance).toHaveBeenCalledWith(
      'https://api.uazapi.com',
      'inst-token'
    );
    expect(configureWebhook).not.toHaveBeenCalled();
  });

  it('rollback: an INSERT error triggers deleteInstance with the new token and 502', async () => {
    insertError = { message: 'insert boom' };

    const res = await POST(postRequest());

    expect(res.status).toBe(502);
    expect(deleteInstance).toHaveBeenCalledWith(
      'https://api.uazapi.com',
      'inst-token'
    );
    expect(configureWebhook).not.toHaveBeenCalled();
  });

  it('webhook failure is non-fatal: row kept, last_connection_error recorded, still 201', async () => {
    configureWebhook.mockRejectedValueOnce(new Error('webhook down'));

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(201);

    // The row was created (INSERT ran) and NOT rolled back.
    expect(insertPayloads).toHaveLength(1);
    expect(deleteInstance).not.toHaveBeenCalled();

    // last_connection_error persisted + reflected in the response.
    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0].last_connection_error).toMatch(/webhook/i);
    expect(json.data.last_connection_error).toMatch(/webhook/i);
  });
});
