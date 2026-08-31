import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateApiKey } from '@/lib/api-keys/keys';
import type { ApiKeyRow } from '@/lib/api-keys/store';
import { ApiError, ok, fail } from '@/lib/api/v1/respond';
import { __resetRateLimitForTests, RATE_LIMITS } from '@/lib/rate-limit';

// Mock the service-role client factory — requireApiKey only stashes
// the returned client in the context; tests never call through it.
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ __isMockAdminClient: true }),
}));

// Mock the store so we control which row a hash resolves to.
const findActiveKeyByHash =
  vi.fn<(hash: string) => Promise<ApiKeyRow | null>>();
const touchLastUsed = vi.fn();
vi.mock('@/lib/api-keys/store', () => ({
  findActiveKeyByHash: (hash: string) => findActiveKeyByHash(hash),
  touchLastUsed: (id: string) => touchLastUsed(id),
}));

// `withApiKey` logs via `after()` (API-N2) — run the callback
// immediately (synchronously) so tests can assert on it without
// waiting for a real deferred execution.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => void) => cb() };
});

// Mock the audit log sink so tests can assert exactly what would have
// been written, without a real Supabase call.
const logApiRequest = vi.fn();
vi.mock('@/lib/api/v1/audit-log', () => ({
  logApiRequest: (entry: unknown) => logApiRequest(entry),
}));

// Import AFTER the mocks are registered.
const { requireApiKey, withApiKey } = await import('./api-context');

const KEY = generateApiKey().plaintext;

function reqWith(authHeader?: string): Request {
  return new Request('https://crm.example.com/api/v1/me', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: 'key-1',
    account_id: 'acct-1',
    created_by: 'user-1',
    name: 'Test key',
    scopes: ['messages:send'],
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  __resetRateLimitForTests();
  findActiveKeyByHash.mockReset();
  touchLastUsed.mockReset();
  logApiRequest.mockReset();
});

afterEach(() => {
  __resetRateLimitForTests();
});

async function expectApiError(
  p: Promise<unknown>,
  code: string,
  status: number
) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: unknown) => {
    const err = e as ApiError;
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });
}

describe('requireApiKey', () => {
  it('401s when no Authorization header is present', async () => {
    await expectApiError(requireApiKey(reqWith()), 'unauthorized', 401);
    expect(findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it("401s on a token that doesn't look like a wacrm key", async () => {
    await expectApiError(
      requireApiKey(reqWith('Bearer some-invite-token')),
      'unauthorized',
      401
    );
    expect(findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it('401s when the key is unknown / revoked / expired (store returns null)', async () => {
    findActiveKeyByHash.mockResolvedValue(null);
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      'unauthorized',
      401
    );
  });

  it('returns a context for a valid key with no scope required', async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`));
    expect(ctx.authType).toBe('api_key');
    expect(ctx.accountId).toBe('acct-1');
    expect(ctx.keyId).toBe('key-1');
    expect(ctx.scopes).toEqual(['messages:send']);
    expect(touchLastUsed).toHaveBeenCalledWith('key-1');
  });

  it("accepts a bare key without the 'Bearer ' prefix", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(KEY));
    expect(ctx.accountId).toBe('acct-1');
  });

  it('403s when the key lacks the required scope', async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ['contacts:read'] }));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), 'messages:send'),
      'forbidden',
      403
    );
  });

  it('passes when the key has the required scope', async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ['messages:send'] }));
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), 'messages:send');
    expect(ctx.accountId).toBe('acct-1');
  });

  it('429s once the per-key budget is exhausted', async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    // Burn the whole window.
    for (let i = 0; i < RATE_LIMITS.publicApi.limit; i++) {
      await requireApiKey(reqWith(`Bearer ${KEY}`));
    }
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      'rate_limited',
      429
    );
  });
});

// ============================================================
// withApiKey — the shared auth + audit-log wrapper every /api/v1/*
// route calls through (API-N2, "API Pública v1" audit).
// ============================================================
describe('withApiKey', () => {
  it('authenticated request: calls the handler and logs account_id/key_id/method/path/status', async () => {
    findActiveKeyByHash.mockResolvedValue(
      row({ id: 'key-42', account_id: 'acct-42' })
    );

    const res = await withApiKey(
      reqWith(`Bearer ${KEY}`),
      undefined,
      async () => ok({ hello: 'world' })
    );

    expect(res.status).toBe(200);
    expect(logApiRequest).toHaveBeenCalledTimes(1);
    const entry = logApiRequest.mock.calls[0][0];
    expect(entry.accountId).toBe('acct-42');
    expect(entry.keyId).toBe('key-42');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/api/v1/me');
    expect(entry.status).toBe(200);
  });

  it('failed authentication: still logs, with accountId/keyId null (no account was ever resolved)', async () => {
    const res = await withApiKey(reqWith(), undefined, async () => ok({}));

    expect(res.status).toBe(401);
    expect(logApiRequest).toHaveBeenCalledTimes(1);
    const entry = logApiRequest.mock.calls[0][0];
    expect(entry.accountId).toBeNull();
    expect(entry.keyId).toBeNull();
    expect(entry.status).toBe(401);
  });

  it('a handler that throws is still logged, mapped through toApiErrorResponse', async () => {
    findActiveKeyByHash.mockResolvedValue(row());

    const res = await withApiKey(
      reqWith(`Bearer ${KEY}`),
      undefined,
      async () => {
        throw new Error('boom');
      }
    );

    expect(res.status).toBe(500);
    expect(logApiRequest).toHaveBeenCalledTimes(1);
    expect(logApiRequest.mock.calls[0][0].status).toBe(500);
  });

  it('a handler that returns fail(...) logs that exact status, not 200', async () => {
    findActiveKeyByHash.mockResolvedValue(row());

    const res = await withApiKey(
      reqWith(`Bearer ${KEY}`),
      undefined,
      async () => fail('not_found', 'nope', 404)
    );

    expect(res.status).toBe(404);
    expect(logApiRequest.mock.calls[0][0].status).toBe(404);
  });

  it('never includes the Authorization header, the API key, or a request/response body in the log entry', async () => {
    findActiveKeyByHash.mockResolvedValue(row());

    await withApiKey(reqWith(`Bearer ${KEY}`), undefined, async () =>
      ok({ secret_field: 'should never be logged' })
    );

    const entry = logApiRequest.mock.calls[0][0];
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('secret_field');
    expect(Object.keys(entry).sort()).toEqual(
      ['accountId', 'keyId', 'method', 'path', 'status'].sort()
    );
  });

  it('a logging failure never breaks the actual API response', async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    logApiRequest.mockImplementation(() => {
      throw new Error('log sink is down');
    });

    // withApiKey must not let a logging exception propagate — the
    // caller's real response is what matters.
    await expect(
      withApiKey(reqWith(`Bearer ${KEY}`), undefined, async () =>
        ok({ ok: true })
      )
    ).resolves.toMatchObject({ status: 200 });
  });

  it('isolation: two different accounts produce two independent log entries with their own account_id', async () => {
    findActiveKeyByHash.mockResolvedValueOnce(
      row({ id: 'key-a', account_id: 'acct-a' })
    );
    await withApiKey(reqWith(`Bearer ${KEY}`), undefined, async () => ok({}));

    findActiveKeyByHash.mockResolvedValueOnce(
      row({ id: 'key-b', account_id: 'acct-b' })
    );
    await withApiKey(reqWith(`Bearer ${KEY}`), undefined, async () => ok({}));

    expect(logApiRequest).toHaveBeenCalledTimes(2);
    expect(logApiRequest.mock.calls[0][0].accountId).toBe('acct-a');
    expect(logApiRequest.mock.calls[1][0].accountId).toBe('acct-b');
  });
});
