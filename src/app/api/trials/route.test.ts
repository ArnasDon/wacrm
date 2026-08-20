import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  routeAssignment: vi.fn(),
  commitAssignment: vi.fn(),
  resolveMarketRegionFromContact: vi.fn(),
  writeEngagementEvent: vi.fn(),
  writeProductInteraction: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));
vi.mock('@/lib/routing/service', () => ({
  routeAssignment: mocks.routeAssignment,
  commitAssignment: mocks.commitAssignment,
  resolveMarketRegionFromContact: mocks.resolveMarketRegionFromContact,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));
vi.mock('@/lib/whatsapp/engagement', () => ({
  writeEngagementEvent: mocks.writeEngagementEvent,
}));
vi.mock('@/lib/analytics/product-interaction', () => ({
  writeProductInteraction: mocks.writeProductInteraction,
}));

const { POST } = await import('./route');

function makeSupabase() {
  const insertCalls: Record<string, unknown>[] = [];
  return {
    insertCalls,
    from: (table: string) => {
      expect(table).toBe('trials');
      const chain = {
        insert: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return chain;
        },
        select: () => chain,
        single: async () => ({ data: { id: 'trial-1', ...insertCalls[0] }, error: null }),
      };
      return chain;
    },
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/trials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/trials', () => {
  it('requires agent+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(request({ phone: '+15551234567' }));
    expect(res.status).toBe(403);
  });

  it('400s when phone is missing — §9.1 requires it even before a Member exists', async () => {
    mocks.requireRole.mockResolvedValueOnce({ supabase: makeSupabase(), accountId: 'acct-1' });
    const res = await POST(request({ name: 'No Phone' }));
    expect(res.status).toBe(400);
  });

  it('assigns a BA, writes the TRIAL engagement event, and starts at ASSIGNED', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    mocks.resolveMarketRegionFromContact.mockResolvedValueOnce({
      marketId: 'market-1',
      regionId: null,
    });
    mocks.routeAssignment.mockResolvedValueOnce({
      assignedBaId: 'ba-1',
      reason: 'Matched market BA via lowest_open_leads (0/10 open leads)',
    });

    const res = await POST(
      request({ phone: '+15551234567', product_id: 'prod-1', contact_id: 'contact-1' })
    );

    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      phone: '+15551234567',
      status: 'ASSIGNED',
      assigned_ba_id: 'ba-1',
    });
    expect(mocks.commitAssignment).toHaveBeenCalledWith(supabase, {
      previousBaId: null,
      nextBaId: 'ba-1',
    });
    expect(mocks.writeEngagementEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'TRIAL', accountId: 'acct-1' })
    );
    expect(mocks.writeProductInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ interactionType: 'trial_request', productId: 'prod-1' })
    );
  });

  it('falls back to REQUESTED status when routing finds nobody', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    mocks.resolveMarketRegionFromContact.mockResolvedValueOnce({
      marketId: null,
      regionId: null,
    });
    mocks.routeAssignment.mockResolvedValueOnce({
      assignedBaId: null,
      reason: 'No market or region on record — routed to Unassigned queue',
    });

    const res = await POST(request({ phone: '+15559876543' }));

    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({ status: 'REQUESTED', assigned_ba_id: null });
    // No BA to credit an open lead to — commitAssignment isn't called at all
    // (unlike customer_requests' POST, which calls it unconditionally and
    // relies on its own no-op-when-unchanged guard).
    expect(mocks.commitAssignment).not.toHaveBeenCalled();
  });
});
