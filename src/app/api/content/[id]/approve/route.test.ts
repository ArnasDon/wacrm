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

function makeSupabase(existingStatus: string | null) {
  const updateCalls: Record<string, unknown>[] = [];
  return {
    updateCalls,
    from: (table: string) => {
      expect(table).toBe('content');
      const chain = {
        update: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return chain;
        },
        eq: () => chain,
        select: () => chain,
        maybeSingle: async () =>
          existingStatus === null
            ? { data: null, error: null }
            : { data: { id: 'ct-1', status: existingStatus }, error: null },
      };
      return chain;
    },
  };
}

function params() {
  return { params: Promise.resolve({ id: 'ct-1' }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/content/ct-1/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/content/[id]/approve', () => {
  it('requires admin — agent role never reaches the route body', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(request({ approve: true }), params());
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('approves In Review content, stamping approved_by/approved_at', async () => {
    const supabase = makeSupabase('In Review');
    mocks.requireRole.mockResolvedValueOnce({ supabase, userId: 'admin-1' });

    const res = await POST(request({ approve: true }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toMatchObject({
      status: 'Approved',
      approved_by: 'admin-1',
    });
    expect(typeof supabase.updateCalls[0].approved_at).toBe('string');
  });

  it('rejects back to Draft and clears approval fields when approve: false', async () => {
    const supabase = makeSupabase('In Review');
    mocks.requireRole.mockResolvedValueOnce({ supabase, userId: 'admin-1' });

    const res = await POST(request({ approve: false }), params());
    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toEqual({
      status: 'Draft',
      approved_by: null,
      approved_at: null,
    });
  });

  it('409s when the content is not in In Review status', async () => {
    const supabase = makeSupabase(null); // .eq('status', 'In Review') matched nothing
    mocks.requireRole.mockResolvedValueOnce({ supabase, userId: 'admin-1' });

    const res = await POST(request({ approve: true }), params());
    expect(res.status).toBe(409);
  });
});
