import { describe, expect, it, vi } from 'vitest';
import {
  routeAssignment,
  commitAssignment,
  resolveMarketRegionFromContact,
  loadRoutingStrategy,
} from './service';

function makeSupabase({
  strategy,
  profilesByScope = {},
  contact,
  rpcResults = {},
}: {
  strategy?: string | null;
  profilesByScope?: Record<string, { user_id: string; open_leads: number; capacity: number }[]>;
  contact?: { market_id: string | null; region_id: string | null } | null;
  rpcResults?: Record<string, unknown>;
} = {}) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  return {
    rpcCalls,
    from: (table: string) => {
      if (table === 'ba_routing_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: strategy === undefined ? null : { strategy },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              const chain = {
                _filters: { [col]: val } as Record<string, string>,
                eq(col2: string, val2: string) {
                  this._filters[col2] = val2;
                  return this;
                },
                then: (resolve: (v: unknown) => void) => {
                  const scopeKey = chain._filters.market_id
                    ? `market:${chain._filters.market_id}`
                    : chain._filters.region_id
                      ? `region:${chain._filters.region_id}`
                      : 'none';
                  resolve({ data: profilesByScope[scopeKey] ?? [], error: null });
                },
              };
              return chain;
            },
          }),
        };
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: contact ?? null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: rpcResults[name] ?? null, error: null };
    },
  };
}

describe('loadRoutingStrategy', () => {
  it('defaults to lowest_open_leads when no settings row exists', async () => {
    const db = makeSupabase({ strategy: undefined });
    const strategy = await loadRoutingStrategy(db as never, 'acct-1');
    expect(strategy).toBe('lowest_open_leads');
  });

  it('returns the account-configured strategy', async () => {
    const db = makeSupabase({ strategy: 'round_robin' });
    const strategy = await loadRoutingStrategy(db as never, 'acct-1');
    expect(strategy).toBe('round_robin');
  });
});

describe('routeAssignment', () => {
  it('routes to Unassigned when strategy is manual, without even checking candidates', async () => {
    const db = makeSupabase({ strategy: 'manual' });
    const decision = await routeAssignment(db as never, {
      accountId: 'acct-1',
      marketId: 'market-1',
      regionId: null,
    });
    expect(decision.assignedBaId).toBeNull();
    expect(decision.reason).toMatch(/manual/i);
  });

  it('routes to Unassigned when neither market nor region has an active BA', async () => {
    const db = makeSupabase({ strategy: 'lowest_open_leads', profilesByScope: {} });
    const decision = await routeAssignment(db as never, {
      accountId: 'acct-1',
      marketId: 'market-1',
      regionId: 'region-1',
    });
    expect(decision.assignedBaId).toBeNull();
    expect(decision.reason).toMatch(/Unassigned/);
  });

  it('picks the market BA with the lowest open-lead count over a busier one', async () => {
    const db = makeSupabase({
      strategy: 'lowest_open_leads',
      profilesByScope: {
        'market:market-1': [
          { user_id: 'ba-busy', open_leads: 8, capacity: 10 },
          { user_id: 'ba-free', open_leads: 1, capacity: 10 },
        ],
      },
    });
    const decision = await routeAssignment(db as never, {
      accountId: 'acct-1',
      marketId: 'market-1',
      regionId: null,
    });
    expect(decision.assignedBaId).toBe('ba-free');
    expect(decision.reason).toMatch(/market BA/);
  });

  it('falls back to a Regional BA when no Market BA covers it (§12 cascade)', async () => {
    const db = makeSupabase({
      strategy: 'lowest_open_leads',
      profilesByScope: {
        'region:region-1': [{ user_id: 'ba-regional', open_leads: 2, capacity: 10 }],
      },
    });
    const decision = await routeAssignment(db as never, {
      accountId: 'acct-1',
      marketId: 'market-with-nobody',
      regionId: 'region-1',
    });
    expect(decision.assignedBaId).toBe('ba-regional');
    expect(decision.reason).toMatch(/region BA/);
  });

  it('round_robin picks candidates by cursor position, sorted by user_id', async () => {
    const db = makeSupabase({
      strategy: 'round_robin',
      profilesByScope: {
        'market:market-1': [
          { user_id: 'ba-b', open_leads: 0, capacity: 10 },
          { user_id: 'ba-a', open_leads: 0, capacity: 10 },
        ],
      },
      rpcResults: { advance_ba_routing_cursor: 1 },
    });
    const decision = await routeAssignment(db as never, {
      accountId: 'acct-1',
      marketId: 'market-1',
      regionId: null,
    });
    // Sorted candidates: [ba-a, ba-b]; cursor 1 % 2 -> ba-b.
    expect(decision.assignedBaId).toBe('ba-b');
    expect(db.rpcCalls[0]).toEqual({
      name: 'advance_ba_routing_cursor',
      args: { p_account_id: 'acct-1' },
    });
  });

  it('skips a BA at capacity in favor of one with headroom', async () => {
    const db = makeSupabase({
      strategy: 'lowest_open_leads',
      profilesByScope: {
        'market:market-1': [
          { user_id: 'ba-at-capacity', open_leads: 10, capacity: 10 },
          { user_id: 'ba-headroom', open_leads: 9, capacity: 20 },
        ],
      },
    });
    const decision = await routeAssignment(db as never, {
      accountId: 'acct-1',
      marketId: 'market-1',
      regionId: null,
    });
    expect(decision.assignedBaId).toBe('ba-headroom');
  });
});

describe('resolveMarketRegionFromContact', () => {
  it('returns nulls when contactId is null', async () => {
    const db = makeSupabase();
    const result = await resolveMarketRegionFromContact(db as never, null);
    expect(result).toEqual({ marketId: null, regionId: null });
  });

  it('reads market/region off the linked contact', async () => {
    const db = makeSupabase({ contact: { market_id: 'm-1', region_id: 'r-1' } });
    const result = await resolveMarketRegionFromContact(db as never, 'contact-1');
    expect(result).toEqual({ marketId: 'm-1', regionId: 'r-1' });
  });
});

describe('commitAssignment', () => {
  it('is a no-op when previous and next are the same', async () => {
    const db = makeSupabase();
    await commitAssignment(db as never, { previousBaId: 'ba-1', nextBaId: 'ba-1' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('decrements the previous BA and increments the next BA on reassignment', async () => {
    const db = makeSupabase();
    await commitAssignment(db as never, { previousBaId: 'ba-old', nextBaId: 'ba-new' });
    expect(db.rpcCalls).toEqual([
      { name: 'adjust_ba_open_leads', args: { p_user_id: 'ba-old', p_delta: -1 } },
      { name: 'adjust_ba_open_leads', args: { p_user_id: 'ba-new', p_delta: 1 } },
    ]);
  });

  it('only increments on first assignment (previousBaId null)', async () => {
    const db = makeSupabase();
    await commitAssignment(db as never, { previousBaId: null, nextBaId: 'ba-new' });
    expect(db.rpcCalls).toEqual([
      { name: 'adjust_ba_open_leads', args: { p_user_id: 'ba-new', p_delta: 1 } },
    ]);
  });

  it('does not throw when the RPC errors — best-effort per its own contract', async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
    };
    await expect(
      commitAssignment(db as never, { previousBaId: 'ba-1', nextBaId: null })
    ).resolves.toBeUndefined();
  });
});
