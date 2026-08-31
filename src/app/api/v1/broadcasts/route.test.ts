import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/v1/broadcasts — route-level test (never had one before).
// Focused on the API-N1 idempotency wiring — createBroadcast/
// deliverBroadcast are mocked so these tests isolate exactly the new
// behavior: a replayed launch must return the ORIGINAL broadcast_id
// and must NEVER re-run the after() fan-out.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  createBroadcast: vi.fn(),
  deliverBroadcast: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/auth/api-context')>();
  return {
    ...actual,
    requireApiKey: mocks.requireApiKey,
    withApiKey: async (
      request: Request,
      scope: string | undefined,
      handler: (ctx: unknown) => Promise<Response>
    ) => {
      const { toApiErrorResponse } = await import('@/lib/api/v1/respond');
      try {
        const ctx = await mocks.requireApiKey(request, scope);
        return await handler(ctx);
      } catch (err) {
        return toApiErrorResponse(err);
      }
    },
  };
});

vi.mock('@/lib/whatsapp/broadcast-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/broadcast-core')>();
  return {
    ...actual,
    createBroadcast: mocks.createBroadcast,
    deliverBroadcast: mocks.deliverBroadcast,
  };
});

// `after()` runs its callback immediately so a test can assert whether
// the fan-out was scheduled, without waiting on real deferred timing.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => void) => cb() };
});

import { POST } from './route';

function fakeIdempotencySupabase(beginOutcome: {
  outcome: string;
  cached_status?: number | null;
  cached_body?: unknown;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const result =
          name === 'begin_idempotent_request'
            ? { data: beginOutcome, error: null }
            : { data: null, error: null };
        return {
          single: async () => result,
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve(result).then(resolve),
        };
      },
      // resolveAuditUserId's whatsapp_config/accounts lookups — always
      // resolves a stable owner so the pipeline can proceed. Not the
      // focus of these tests.
      from: () => {
        const api = {
          select: () => api,
          eq: () => api,
          maybeSingle: async () => ({
            data: { user_id: 'user-1', owner_user_id: 'user-1' },
            error: null,
          }),
        };
        return api;
      },
    } as never,
    calls,
  };
}

function postRequest(body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return new Request('http://localhost/api/v1/broadcasts', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const RECIPIENTS = [{ to: '+15550001111' }];

beforeEach(() => {
  mocks.requireApiKey.mockReset();
  mocks.createBroadcast.mockReset();
  mocks.deliverBroadcast.mockReset();
});

describe('POST /api/v1/broadcasts', () => {
  it('launches normally with no Idempotency-Key header (unchanged behavior)', async () => {
    const { supabase } = fakeIdempotencySupabase({ outcome: 'proceed' });
    mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });
    mocks.createBroadcast.mockResolvedValue({
      broadcastId: 'bc-1',
      planned: [{ to: '+15550001111' }],
      rejected: [],
    });

    const res = await POST(
      postRequest({ template_name: 'promo', recipients: RECIPIENTS })
    );
    const body = (await res.json()) as { data: { broadcast_id: string } };

    expect(res.status).toBe(202);
    expect(body.data.broadcast_id).toBe('bc-1');
    expect(mocks.deliverBroadcast).toHaveBeenCalledTimes(1);
  });

  describe('with Idempotency-Key', () => {
    it("first launch (outcome 'proceed'): creates the broadcast, runs the fan-out once, caches the response", async () => {
      const { supabase, calls } = fakeIdempotencySupabase({
        outcome: 'proceed',
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });
      mocks.createBroadcast.mockResolvedValue({
        broadcastId: 'bc-1',
        planned: [{ to: '+15550001111' }],
        rejected: [],
      });

      const res = await POST(
        postRequest({ template_name: 'promo', recipients: RECIPIENTS }, 'key-x')
      );

      expect(res.status).toBe(202);
      expect(mocks.createBroadcast).toHaveBeenCalledTimes(1);
      expect(mocks.deliverBroadcast).toHaveBeenCalledTimes(1);
      expect(calls.some((c) => c.name === 'complete_idempotent_request')).toBe(
        true
      );
    });

    it("repeated launch (outcome 'replay'): returns the ORIGINAL broadcast_id, does NOT create a second broadcast or re-run the fan-out", async () => {
      const { supabase } = fakeIdempotencySupabase({
        outcome: 'replay',
        cached_status: 202,
        cached_body: {
          data: {
            broadcast_id: 'bc-original',
            status: 'sending',
            total_recipients: 1,
            accepted: 1,
            rejected: [],
          },
        },
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(
        postRequest({ template_name: 'promo', recipients: RECIPIENTS }, 'key-x')
      );
      const body = (await res.json()) as { data: { broadcast_id: string } };

      expect(res.status).toBe(202);
      expect(body.data.broadcast_id).toBe('bc-original');
      // The actual duplicate-send proof: neither the broadcast row NOR
      // the recipient fan-out is ever created/run a second time.
      expect(mocks.createBroadcast).not.toHaveBeenCalled();
      expect(mocks.deliverBroadcast).not.toHaveBeenCalled();
    });

    it("same key, different recipients (outcome 'conflict'): 409, nothing launched", async () => {
      const { supabase } = fakeIdempotencySupabase({ outcome: 'conflict' });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(
        postRequest(
          { template_name: 'promo', recipients: [{ to: '+15559998888' }] },
          'key-x'
        )
      );
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.error.code).toBe('idempotency_key_reused');
      expect(mocks.createBroadcast).not.toHaveBeenCalled();
    });

    it("concurrent launch (outcome 'in_progress'): 409, nothing launched — no double fan-out across the race", async () => {
      const { supabase } = fakeIdempotencySupabase({ outcome: 'in_progress' });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(
        postRequest({ template_name: 'promo', recipients: RECIPIENTS }, 'key-x')
      );
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.error.code).toBe('idempotency_key_in_progress');
      expect(mocks.createBroadcast).not.toHaveBeenCalled();
      expect(mocks.deliverBroadcast).not.toHaveBeenCalled();
    });
  });
});
