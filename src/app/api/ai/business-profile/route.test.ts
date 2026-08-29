import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// PUT /api/ai/business-profile — no test existed for this route before
// this fix (only service.ts had unit tests, against a fake db, never
// through the route's own body-parsing). This suite exercises the REAL
// route handler + the REAL service.ts partial-update logic together
// (only auth/rate-limit are mocked, same convention as the project's
// other route.test.ts files — usage/route.test.ts, contacts/[id]/tags),
// against a fake Supabase table that behaves like Postgres: an
// `.update(row)` only touches the columns present in `row`.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) => Response.json({ error: String(err) }, { status: 500 })),
}));

import { GET, PUT } from './route';

/** Same one-table fake as service.test.ts's fakeDb, inlined here since
 *  this suite only ever touches `account_business_profiles`. `.update`
 *  uses `Object.assign` — i.e. only the keys present in the payload are
 *  overwritten, exactly like a real Postgres `UPDATE ... SET` from a
 *  partial JSON body via PostgREST. */
function fakeSupabase() {
  let row: Record<string, unknown> | null = null;
  const emptyList = () => ({
    eq: () => ({
      order: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
  });
  const api = {
    from: (table: string) => {
      // GET's Promise.all also queries departments/contacts (see
      // service.ts's listDepartments/listContacts) — this suite only
      // exercises the profile row itself, so both are always empty.
      if (table === 'account_business_departments' || table === 'account_business_contacts') {
        return { select: emptyList };
      }
      if (table !== 'account_business_profiles') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              row = { id: 'profile-1', created_at: 'now', updated_at: 'now', ...payload };
              return { data: row, error: null };
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                Object.assign(row!, payload);
                return { data: row, error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { supabase: api as never, getRow: () => row };
}

function putRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/business-profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('PUT /api/ai/business-profile — partial update at the route layer', () => {
  it('a body with ONLY identity keys creates the row without departments/location/hours ever being mentioned', async () => {
    const { supabase, getRow } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await PUT(putRequest({ business_name: 'Kuki CompuCell', phone: '809-284-3495' }));
    expect(res.status).toBe(200);

    const row = getRow()!;
    expect(row.business_name).toBe('Kuki CompuCell');
    expect(row.phone).toBe('809-284-3495');
    // Column defaults (migration 050) fill in the rest on a first
    // insert — never null-by-code, never overwritten by this PUT.
    expect(row.google_maps_url).toBeUndefined();
    expect(row.business_hours).toBeUndefined();
  });

  it('a second PUT with only google_maps_url does not touch business_name from the first PUT', async () => {
    const { supabase, getRow } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await PUT(putRequest({ business_name: 'Kuki CompuCell' }));
    const res = await PUT(putRequest({ google_maps_url: 'https://maps.google.com/?q=Duarte+88' }));
    expect(res.status).toBe(200);

    const row = getRow()!;
    expect(row.business_name).toBe('Kuki CompuCell');
    expect(row.google_maps_url).toBe('https://maps.google.com/?q=Duarte+88');
  });

  it('a real, non-empty business_hours object survives verbatim, never collapsed to {}', async () => {
    const { supabase, getRow } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const hours = { monday: { enabled: true, open: '09:00', close: '18:00' } };
    const res = await PUT(putRequest({ business_hours: hours }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { profile: { businessHours: unknown } };
    expect(body.profile.businessHours).toEqual(hours);
    expect(getRow()!.business_hours).toEqual(hours);
  });

  it('an explicit null clears a field only when the key is actually present in the body', async () => {
    const { supabase, getRow } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await PUT(putRequest({ business_name: 'Kuki CompuCell', description: 'Tienda de tecnología' }));
    // Clears description, but description's key is the ONLY one sent —
    // business_name must not even be mentioned, let alone cleared.
    await PUT(putRequest({ description: null }));

    const row = getRow()!;
    expect(row.business_name).toBe('Kuki CompuCell');
    expect(row.description).toBeNull();
  });

  it('GET returns the profile shaped for the UI (camelCase), reading whatever PUT actually stored', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await PUT(putRequest({ business_name: 'Kuki CompuCell', google_maps_url: 'https://maps.google.com/?q=x' }));
    const res = await GET();
    const body = (await res.json()) as { profile: { businessName: string; googleMapsUrl: string | null } };

    expect(body.profile.businessName).toBe('Kuki CompuCell');
    expect(body.profile.googleMapsUrl).toBe('https://maps.google.com/?q=x');
  });
});
