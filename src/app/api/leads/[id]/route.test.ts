import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  commitAssignment: vi.fn(),
  writeEngagementEvent: vi.fn(),
  writeProductInteraction: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ marker: 'admin' }),
}));
vi.mock('@/lib/routing/service', () => ({
  commitAssignment: mocks.commitAssignment,
}));
vi.mock('@/lib/whatsapp/engagement', () => ({
  writeEngagementEvent: mocks.writeEngagementEvent,
}));
vi.mock('@/lib/analytics/product-interaction', () => ({
  writeProductInteraction: mocks.writeProductInteraction,
}));

const { PATCH } = await import('./route');

function makeSupabase({
  existing,
  updated,
  profileUserId,
}: {
  existing: Record<string, unknown> | null;
  updated: Record<string, unknown> | null;
  profileUserId?: string;
}) {
  const updateCalls: Record<string, unknown>[] = [];
  return {
    updateCalls,
    from: (table: string) => {
      if (table === 'deals') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }),
          }),
          update: (values: Record<string, unknown>) => {
            updateCalls.push(values);
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: updated, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: profileUserId ? { user_id: profileUserId } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/leads/lead-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/leads/[id]', () => {
  it('requires agent+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await PATCH(patchRequest({ status: 'CONTACTED' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    expect(res.status).toBe(403);
  });

  it('404s when the Lead does not exist', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({ existing: null, updated: null }),
      accountId: 'acct-1',
    });
    const res = await PATCH(patchRequest({ status: 'CONTACTED' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s on an invalid status', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({
        existing: { status: 'NEW', assigned_to: null, contact_id: 'c-1', campaign_id: null },
        updated: null,
      }),
      accountId: 'acct-1',
    });
    const res = await PATCH(patchRequest({ status: 'MAYBE' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('CONVERTED transition decrements the assignee open_leads and fires the CONVERSION event + product interaction', async () => {
    const supabase = makeSupabase({
      existing: {
        status: 'INTERESTED',
        assigned_to: 'profile-old',
        contact_id: 'contact-1',
        campaign_id: 'camp-1',
      },
      updated: {
        id: 'lead-1',
        status: 'CONVERTED',
        assigned_to: 'profile-old',
        campaign: { product_id: 'prod-9' },
      },
      profileUserId: 'user-old',
    });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });

    const res = await PATCH(patchRequest({ status: 'CONVERTED' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    });

    expect(res.status).toBe(200);
    expect(supabase.updateCalls[0]).toMatchObject({ status: 'CONVERTED' });
    // Entering a terminal status closes the lead out of the assignee's
    // open count — decrement, not increment.
    expect(mocks.commitAssignment).toHaveBeenCalledWith(supabase, {
      previousBaId: 'user-old',
      nextBaId: null,
    });
    expect(mocks.writeEngagementEvent).toHaveBeenCalledWith(
      { marker: 'admin' },
      expect.objectContaining({
        eventType: 'CONVERSION',
        memberId: 'contact-1',
        campaignId: 'camp-1',
      })
    );
    expect(mocks.writeProductInteraction).toHaveBeenCalledWith(
      { marker: 'admin' },
      expect.objectContaining({ interactionType: 'conversion', productId: 'prod-9' })
    );
  });

  it('does not touch open_leads or fire CONVERSION for a non-terminal status change', async () => {
    const supabase = makeSupabase({
      existing: {
        status: 'NEW',
        assigned_to: 'profile-old',
        contact_id: 'contact-1',
        campaign_id: null,
      },
      updated: { id: 'lead-1', status: 'CONTACTED', assigned_to: 'profile-old', campaign: null },
      profileUserId: 'user-old',
    });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });

    await PATCH(patchRequest({ status: 'CONTACTED' }), {
      params: Promise.resolve({ id: 'lead-1' }),
    });

    expect(mocks.commitAssignment).not.toHaveBeenCalled();
    expect(mocks.writeEngagementEvent).not.toHaveBeenCalled();
  });
});
