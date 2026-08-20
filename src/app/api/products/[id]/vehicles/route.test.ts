import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

const { POST } = await import('./route');

function makeSupabase(result: {
  data: unknown;
  error: { code: string; message: string } | null;
}) {
  const insertCalls: Record<string, unknown>[] = [];
  return {
    insertCalls,
    from: (table: string) => {
      expect(table).toBe('product_vehicles');
      const chain = {
        insert: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return chain;
        },
        select: () => chain,
        single: async () => result,
      };
      return chain;
    },
  };
}

function params() {
  return { params: Promise.resolve({ id: 'prod-1' }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/products/prod-1/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/products/[id]/vehicles', () => {
  it('requires admin — verified compatibility is administrator-curated (§11)', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(request({ vehicle_id: 'veh-1' }), params());
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('400s when vehicle_id is missing', async () => {
    const supabase = makeSupabase({ data: null, error: null });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({}), params());
    expect(res.status).toBe(400);
  });

  it('stamps verified_by with the acting admin', async () => {
    const supabase = makeSupabase({
      data: { id: 'compat-1' },
      error: null,
    });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ vehicle_id: 'veh-1' }), params());
    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      product_id: 'prod-1',
      vehicle_id: 'veh-1',
      verified_by: 'admin-1',
    });
  });

  it('409s on a duplicate compatibility row (UNIQUE product_id, vehicle_id)', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ vehicle_id: 'veh-1' }), params());
    expect(res.status).toBe(409);
  });

  it('404s when the product or vehicle FK does not resolve', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '23503', message: 'fk violation' },
    });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ vehicle_id: 'veh-1' }), params());
    expect(res.status).toBe(404);
  });
});
