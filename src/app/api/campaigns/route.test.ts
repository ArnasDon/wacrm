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

function makeSupabase() {
  const insertCalls: Record<string, unknown>[] = [];
  return {
    insertCalls,
    from: (table: string) => {
      expect(table).toBe('campaigns');
      const chain = {
        insert: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return chain;
        },
        select: () => chain,
        single: async () => ({
          data: { id: 'camp-1', ...insertCalls[0] },
          error: null,
        }),
      };
      return chain;
    },
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/campaigns', () => {
  it('requires agent+, not admin — a BA can run a campaign (migration 043)', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(request({ campaign_name: 'Winter Push' }));
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
  });

  it('400s when campaign_name is missing', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'agent-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ campaign_name: '  ' }));
    expect(res.status).toBe(400);
  });

  it('400s on a malformed date string', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'agent-1',
      accountId: 'acct-1',
    });
    const res = await POST(
      request({ campaign_name: 'Winter Push', start_date: '12/25/2026' })
    );
    expect(res.status).toBe(400);
  });

  it('400s on a negative cost', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'agent-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ campaign_name: 'Winter Push', cost: -5 }));
    expect(res.status).toBe(400);
  });

  it('creates a Draft campaign with no cost when none is given (§13 — never fabricate cost data)', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'agent-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ campaign_name: 'Winter Push' }));
    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      account_id: 'acct-1',
      campaign_name: 'Winter Push',
      status: 'draft',
      cost: null,
      created_by: 'agent-1',
    });
  });
});
