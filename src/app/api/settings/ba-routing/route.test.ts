import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));

const { GET, PATCH } = await import('./route');

function makeSupabase(row: { strategy: string } | null) {
  return {
    from: (table: string) => {
      expect(table).toBe('ba_routing_settings');
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
        upsert: (values: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({ data: { strategy: values.strategy }, error: null }),
          }),
        }),
      };
    },
  };
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/settings/ba-routing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/settings/ba-routing', () => {
  it('defaults to lowest_open_leads when no row exists yet', async () => {
    mocks.requireRole.mockResolvedValueOnce({ supabase: makeSupabase(null), accountId: 'a-1' });
    const res = await GET();
    const data = await res.json();
    expect(data.strategy).toBe('lowest_open_leads');
  });

  it('returns the configured strategy', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({ strategy: 'round_robin' }),
      accountId: 'a-1',
    });
    const res = await GET();
    const data = await res.json();
    expect(data.strategy).toBe('round_robin');
  });
});

describe('PATCH /api/settings/ba-routing', () => {
  it('requires admin+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await PATCH(patchRequest({ strategy: 'manual' }));
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('400s on an unknown strategy', async () => {
    mocks.requireRole.mockResolvedValueOnce({ supabase: makeSupabase(null), accountId: 'a-1' });
    const res = await PATCH(patchRequest({ strategy: 'vibes' }));
    expect(res.status).toBe(400);
  });

  it('upserts the strategy on success', async () => {
    mocks.requireRole.mockResolvedValueOnce({ supabase: makeSupabase(null), accountId: 'a-1' });
    const res = await PATCH(patchRequest({ strategy: 'manual' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.strategy).toBe('manual');
  });
});
