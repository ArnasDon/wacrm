import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  orFilters: [] as string[],
  queried: false,
}));

function fakeSupabase() {
  const builder: Record<string, unknown> = {
    select: () => {
      mocks.queried = true;
      return builder;
    },
    eq: () => builder,
    or: (filter: string) => {
      mocks.orFilters.push(filter);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };
  return { from: () => builder };
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: fakeSupabase(),
    accountId: 'account-1',
  })),
}));

import { GET } from './route';

beforeEach(() => {
  mocks.orFilters = [];
  mocks.queried = false;
});

describe('GET /api/v1/contacts', () => {
  it('rejects a non-UUID tag filter with 400 bad_request without querying', async () => {
    const res = await GET(
      new Request('https://x.test/api/v1/contacts?tag=vip')
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_request');
    expect(mocks.queried).toBe(false);
  });

  it('searches phones by digits so a +E.164 search can match stored numbers', async () => {
    const res = await GET(
      new Request(
        `https://x.test/api/v1/contacts?search=${encodeURIComponent('+14155551234')}`
      )
    );
    expect(res.status).toBe(200);
    expect(mocks.orFilters).toContain(
      'name.ilike.*+14155551234*,phone.ilike.*14155551234*'
    );
  });
});
