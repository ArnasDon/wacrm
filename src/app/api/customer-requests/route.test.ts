import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  routeAssignment: vi.fn(),
  commitAssignment: vi.fn(),
  resolveMarketRegionFromContact: vi.fn(),
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
vi.mock('@/lib/analytics/product-interaction', () => ({
  writeProductInteraction: mocks.writeProductInteraction,
}));

const { POST } = await import('./route');

function makeSupabase() {
  const insertCalls: Record<string, unknown>[] = [];
  return {
    insertCalls,
    from: (table: string) => {
      expect(table).toBe('customer_requests');
      const chain = {
        insert: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return chain;
        },
        select: () => chain,
        single: async () => ({
          data: { id: 'cr-1', ...insertCalls[0] },
          error: null,
        }),
      };
      return chain;
    },
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/customer-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/customer-requests', () => {
  it('requires agent+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(request({ type: 'GENERAL_ENQUIRY' }));
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
  });

  it('400s on an invalid type', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase(),
      accountId: 'acct-1',
    });
    const res = await POST(request({ type: 'NOT_A_REAL_TYPE' }));
    expect(res.status).toBe(400);
  });

  it('400s on an invalid source', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase(),
      accountId: 'acct-1',
    });
    const res = await POST(request({ type: 'GENERAL_ENQUIRY', source: 'carrier_pigeon' }));
    expect(res.status).toBe(400);
  });

  it('routes via §12 LeadRoutingService and stamps assignment + reason (happy path, matched BA)', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    mocks.resolveMarketRegionFromContact.mockResolvedValueOnce({
      marketId: 'market-1',
      regionId: null,
    });
    mocks.routeAssignment.mockResolvedValueOnce({
      assignedBaId: 'ba-1',
      reason: 'Matched market BA via lowest_open_leads (2/10 open leads)',
    });

    const res = await POST(
      request({ type: 'TRIAL_REQUEST', contact_id: 'contact-1', product_id: 'prod-1' })
    );

    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      account_id: 'acct-1',
      type: 'TRIAL_REQUEST',
      status: 'ASSIGNED',
      assigned_ba_id: 'ba-1',
      routing_reason: 'Matched market BA via lowest_open_leads (2/10 open leads)',
    });
    expect(mocks.commitAssignment).toHaveBeenCalledWith(supabase, {
      previousBaId: null,
      nextBaId: 'ba-1',
    });
    // TRIAL_REQUEST maps to the trial_request interaction type, not enquiry.
    expect(mocks.writeProductInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ interactionType: 'trial_request', productId: 'prod-1' })
    );
  });

  it('leaves status NEW and assigned_ba_id null when routing finds nobody (Unassigned queue)', async () => {
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

    const res = await POST(request({ type: 'GENERAL_ENQUIRY' }));

    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      status: 'NEW',
      assigned_ba_id: null,
    });
    expect(mocks.commitAssignment).toHaveBeenCalledWith(supabase, {
      previousBaId: null,
      nextBaId: null,
    });
  });
});
