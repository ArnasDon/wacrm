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
      expect(table).toBe('campaigns');
      const chain = {
        update: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return chain;
        },
        delete: () => {
          deleteCalls.push('campaigns');
          return chain;
        },
        eq: () => chain,
        select: () => chain,
        maybeSingle: async () => ({
          data: { id: 'camp-1', ...updateCalls[0] },
          error: null,
        }),
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return chain;
    },
  };
}

function params() {
  return { params: Promise.resolve({ id: 'camp-1' }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/campaigns/camp-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/campaigns/[id]', () => {
  it('requires agent+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await PATCH(request({ status: 'active' }), params());
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
  });

  it('400s on an invalid status value', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ status: 'launched' }), params());
    expect(res.status).toBe(400);
  });

  it('accepts a valid status transition', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ status: 'active' }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toEqual({ status: 'active' });
  });

  it('400s on a malformed end_date', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ end_date: 'not-a-date' }), params());
    expect(res.status).toBe(400);
  });

  it('allows clearing cost back to null', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await PATCH(request({ cost: null }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toEqual({ cost: null });
  });
});

describe('DELETE /api/campaigns/[id]', () => {
  it('requires agent+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await DELETE(new Request('http://localhost'), params());
    expect(res.status).toBe(403);
  });

  it('deletes the campaign', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await DELETE(new Request('http://localhost'), params());
    expect(res.status).toBe(200);
    expect(supabase.deleteCalls).toEqual(['campaigns']);
  });
});
