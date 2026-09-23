import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateApiKey } from '@/lib/api-keys/keys';
import type { ApiKeyRow } from '@/lib/api-keys/store';
import { ApiError } from '@/lib/api/v1/respond';
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

// Import AFTER the mocks are registered.
const { requireApiKey } = await import('./api-context');

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
