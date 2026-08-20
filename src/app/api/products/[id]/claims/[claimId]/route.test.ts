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

function makeSupabase() {
  const updateCalls: Record<string, unknown>[] = [];
  const deleteCalls: string[] = [];
  return {
    updateCalls,
    deleteCalls,
    from: (table: string) => {
      expect(table).toBe('product_claims');
      const chain = {
        update: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return chain;
        },
        delete: () => {
          deleteCalls.push('product_claims');
          return chain;
        },
        eq: () => chain,
        select: () => chain,
        maybeSingle: async () => ({
          data: { id: 'claim-1', ...updateCalls[0] },
          error: null,
        }),
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return chain;
    },
  };
}

function params() {
  return { params: Promise.resolve({ id: 'prod-1', claimId: 'claim-1' }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/products/prod-1/claims/claim-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/products/[id]/claims/[claimId]', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await PATCH(request({ status: 'approved' }), params());
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('400s on an invalid status value', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase, userId: 'admin-1' });
    const res = await PATCH(request({ status: 'maybe' }), params());
    expect(res.status).toBe(400);
  });

  it('approving stamps approved_by/approved_at — this is the only path that lets a claim be shown as fact (§2)', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase, userId: 'admin-1' });
    const res = await PATCH(request({ status: 'approved' }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toMatchObject({
      status: 'approved',
      approved_by: 'admin-1',
    });
    expect(typeof supabase.updateCalls[0].approved_at).toBe('string');
  });

  it('rejecting clears approved_by/approved_at even if it was previously approved', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase, userId: 'admin-1' });
    const res = await PATCH(request({ status: 'rejected' }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toEqual({
      status: 'rejected',
      approved_by: null,
      approved_at: null,
    });
  });
});

describe('DELETE /api/products/[id]/claims/[claimId]', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await DELETE(new Request('http://localhost'), params());
    expect(res.status).toBe(403);
  });

  it('deletes the claim', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await DELETE(new Request('http://localhost'), params());
    expect(res.status).toBe(200);
    expect(supabase.deleteCalls).toEqual(['product_claims']);
  });
});
