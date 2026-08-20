import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeAssignment: vi.fn(),
  commitAssignment: vi.fn(),
  resolveMarketRegionFromContact: vi.fn(),
  writeEngagementEvent: vi.fn(),
  writeProductInteraction: vi.fn(),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ marker: 'admin' }),
}));
vi.mock('@/lib/routing/service', () => ({
  routeAssignment: mocks.routeAssignment,
  commitAssignment: mocks.commitAssignment,
  resolveMarketRegionFromContact: mocks.resolveMarketRegionFromContact,
}));
vi.mock('@/lib/whatsapp/engagement', () => ({
  writeEngagementEvent: mocks.writeEngagementEvent,
}));
vi.mock('@/lib/analytics/product-interaction', () => ({
  writeProductInteraction: mocks.writeProductInteraction,
}));

const { createLead } = await import('./create-lead');

interface FakeState {
  pipelines: { id: string; account_id: string; created_at: string }[];
  stages: { id: string; pipeline_id: string; position: number }[];
  profiles: { id: string; user_id: string }[];
  insertedDeal: Record<string, unknown> | null;
}

function makeSupabase(state: FakeState) {
  return {
    from: (table: string) => {
      if (table === 'pipelines') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: state.pipelines[0] ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          insert: (values: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const row = { id: 'new-pipeline', ...values };
                state.pipelines.push(row as never);
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'pipeline_stages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: state.stages[0] ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          insert: async () => ({ data: null, error: null }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({
                data: state.profiles.find((p) => p.user_id === val) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'deals') {
        return {
          insert: (values: Record<string, unknown>) => {
            state.insertedDeal = values;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'lead-1', ...values, campaign: null },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('createLead', () => {
  it('reuses an existing pipeline/stage rather than creating a new one', async () => {
    const state: FakeState = {
      pipelines: [{ id: 'pipe-1', account_id: 'acct-1', created_at: '2026-01-01' }],
      stages: [{ id: 'stage-1', pipeline_id: 'pipe-1', position: 0 }],
      profiles: [],
      insertedDeal: null,
    };
    const db = makeSupabase(state);
    mocks.resolveMarketRegionFromContact.mockResolvedValueOnce({
      marketId: null,
      regionId: null,
    });
    mocks.routeAssignment.mockResolvedValueOnce({ assignedBaId: null, reason: 'Unassigned' });

    await createLead(db as never, {
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'c-1',
      title: 'Fleet enquiry',
      source: 'manual',
    });

    expect(state.insertedDeal).toMatchObject({ pipeline_id: 'pipe-1', stage_id: 'stage-1' });
    expect(state.pipelines).toHaveLength(1); // no new pipeline created
  });

  it('creates a default Sales Pipeline + spec stages when the account has none', async () => {
    const state: FakeState = {
      pipelines: [],
      stages: [{ id: 'auto-stage', pipeline_id: 'new-pipeline', position: 0 }],
      profiles: [],
      insertedDeal: null,
    };
    const db = makeSupabase(state);
    mocks.resolveMarketRegionFromContact.mockResolvedValueOnce({
      marketId: null,
      regionId: null,
    });
    mocks.routeAssignment.mockResolvedValueOnce({ assignedBaId: null, reason: 'Unassigned' });

    await createLead(db as never, {
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'c-1',
      title: 'Fleet enquiry',
      source: 'manual',
    });

    expect(state.pipelines).toHaveLength(1);
    expect(state.insertedDeal).toMatchObject({ pipeline_id: 'new-pipeline' });
  });

  it('translates the routed profiles.user_id into profiles.id for deals.assigned_to', async () => {
    const state: FakeState = {
      pipelines: [{ id: 'pipe-1', account_id: 'acct-1', created_at: '2026-01-01' }],
      stages: [{ id: 'stage-1', pipeline_id: 'pipe-1', position: 0 }],
      profiles: [{ id: 'profile-row-9', user_id: 'ba-user-9' }],
      insertedDeal: null,
    };
    const db = makeSupabase(state);
    mocks.resolveMarketRegionFromContact.mockResolvedValueOnce({
      marketId: 'market-1',
      regionId: null,
    });
    mocks.routeAssignment.mockResolvedValueOnce({
      assignedBaId: 'ba-user-9',
      reason: 'Matched market BA via lowest_open_leads (0/10 open leads)',
    });

    await createLead(db as never, {
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'c-1',
      title: 'Fleet enquiry',
      source: 'manual',
    });

    // deals.assigned_to must be the profiles.id, NOT the routed user_id
    // (migration 002's FK target differs from customer_requests/trials).
    expect(state.insertedDeal).toMatchObject({ assigned_to: 'profile-row-9', status: 'ASSIGNED' });
    expect(mocks.commitAssignment).toHaveBeenCalledWith(db, {
      previousBaId: null,
      nextBaId: 'ba-user-9', // commitAssignment/adjust_ba_open_leads stays in user_id terms
    });
    expect(mocks.writeEngagementEvent).toHaveBeenCalledWith(
      { marker: 'admin' },
      expect.objectContaining({ eventType: 'LEAD', memberId: 'c-1' })
    );
  });
});
