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

const { PATCH, DELETE } = await import('./route');

function makeSupabase(existing: Record<string, unknown> | null) {
  const updateCalls: Record<string, unknown>[] = [];
  const deleteCalls: string[] = [];
  return {
    updateCalls,
    deleteCalls,
    from: (table: string) => {
      expect(table).toBe('products');
      const chain = {
        update: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return chain;
        },
        delete: () => {
          deleteCalls.push('products');
          return chain;
        },
        eq: () => chain,
        select: () => chain,
        maybeSingle: async () =>
          existing === null
            ? { data: null, error: null }
            : { data: { ...existing, ...updateCalls[0] }, error: null },
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return chain;
    },
  };
}

function params(id = 'prod-1') {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/products/prod-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/products/[id]', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await PATCH(request({ status: 'published' }), params());
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('400s on an invalid status value', async () => {
    const supabase = makeSupabase({ id: 'prod-1' });
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ status: 'not-a-status' }), params());
    expect(res.status).toBe(400);
    expect(supabase.updateCalls).toHaveLength(0);
  });

  it('accepts a valid status transition', async () => {
    const supabase = makeSupabase({ id: 'prod-1' });
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ status: 'published' }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toEqual({ status: 'published' });
  });

  it('drops blank/non-string entries from array fields', async () => {
    const supabase = makeSupabase({ id: 'prod-1' });
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(
      request({ key_features: ['Low ash', '  ', 42, 'Shear stable'] }),
      params()
    );
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toEqual({
      key_features: ['Low ash', 'Shear stable'],
    });
  });

  it('400s when no editable fields are provided', async () => {
    const supabase = makeSupabase({ id: 'prod-1' });
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({}), params());
    expect(res.status).toBe(400);
  });

  it('404s when the product does not exist', async () => {
    const supabase = makeSupabase(null);
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ status: 'archived' }), params());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/products/[id]', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await DELETE(new Request('http://localhost'), params());
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('deletes the product', async () => {
    const supabase = makeSupabase({ id: 'prod-1' });
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await DELETE(new Request('http://localhost'), params());
    expect(res.status).toBe(200);
    expect(supabase.deleteCalls).toEqual(['products']);
  });
});
