import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/v1/respond';

const lookup = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => lookup.result,
    };
    return { from: () => builder };
  },
}));

const { findActiveKeyByHash } = await import('./store');

const activeRow = {
  id: 'key-1',
  account_id: 'acct-1',
  created_by: null,
  name: 'Key',
  scopes: [],
  expires_at: null,
  revoked_at: null,
};

beforeEach(() => {
  lookup.result = { data: null, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('findActiveKeyByHash', () => {
  it('returns the row for an active key', async () => {
    lookup.result = { data: activeRow, error: null };
    await expect(findActiveKeyByHash('h')).resolves.toEqual(activeRow);
  });

  it('returns null when no key matches', async () => {
    await expect(findActiveKeyByHash('h')).resolves.toBeNull();
  });

  it('returns null for a revoked key', async () => {
    lookup.result = {
      data: { ...activeRow, revoked_at: '2026-01-01T00:00:00Z' },
      error: null,
    };
    await expect(findActiveKeyByHash('h')).resolves.toBeNull();
  });

  it('throws a 503 ApiError when the lookup fails', async () => {
    lookup.result = { data: null, error: { message: 'connection refused' } };
    const err = await findActiveKeyByHash('h').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).code).toBe('unavailable');
  });
});
