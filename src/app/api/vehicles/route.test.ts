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
      expect(table).toBe('vehicles');
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

function request(body: unknown) {
  return new Request('http://localhost/api/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/vehicles', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(
      request({
        vehicle_type: 'Heavy Truck',
        manufacturer: 'Hino',
        model: '500',
      })
    );
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('400s when vehicle_type, manufacturer, or model is missing', async () => {
    const supabase = makeSupabase({ data: null, error: null });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    const res = await POST(request({ vehicle_type: 'Heavy Truck' }));
    expect(res.status).toBe(400);
  });

  it('defaults engine to an empty string, not null, so the UNIQUE constraint dedups correctly', async () => {
    const supabase = makeSupabase({ data: { id: 'veh-1' }, error: null });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    const res = await POST(
      request({
        vehicle_type: 'Heavy Truck',
        manufacturer: 'Hino',
        model: '500 Series',
      })
    );
    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      account_id: 'acct-1',
      vehicle_type: 'Heavy Truck',
      manufacturer: 'Hino',
      model: '500 Series',
      engine: '',
    });
  });

  it('409s on a duplicate vehicle tuple', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    const res = await POST(
      request({
        vehicle_type: 'Heavy Truck',
        manufacturer: 'Hino',
        model: '500 Series',
      })
    );
    expect(res.status).toBe(409);
  });
});
