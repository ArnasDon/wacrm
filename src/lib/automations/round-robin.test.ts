import { describe, expect, it } from 'vitest';
import { pickRoundRobinDealAssignee, resolveAssigneeProfileId } from './round-robin';

/**
 * Fake Supabase client covering every query this module makes:
 * `profiles` (account members ordered, for the round-robin pick; or a
 * single row by user_id, for resolveAssigneeProfileId) and `deals`
 * (open deals' assignees). Each `.eq()`/`.not()`/`.order()` call just
 * returns the builder so the chain resolves to whatever the test queues.
 */
function fakeDb({
  members,
  openDeals = [],
  profilesByUserId = {},
}: {
  members: { id: string }[];
  openDeals?: { assigned_to: string }[];
  profilesByUserId?: Record<string, { id: string } | undefined>;
}) {
  return {
    from(table: string) {
      if (table === 'profiles') {
        const filters: Record<string, string> = {};
        const builder = {
          select() {
            return builder;
          },
          eq(column: string, value: string) {
            filters[column] = value;
            return builder;
          },
          order() {
            return Promise.resolve({ data: members, error: null });
          },
          maybeSingle() {
            const row = filters.user_id ? profilesByUserId[filters.user_id] : undefined;
            return Promise.resolve({ data: row ?? null, error: null });
          },
        };
        return builder;
      }
      if (table === 'deals') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          not() {
            return Promise.resolve({ data: openDeals, error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('pickRoundRobinDealAssignee', () => {
  it('returns null when the account has no members', async () => {
    const db = fakeDb({ members: [] });
    expect(await pickRoundRobinDealAssignee(db, 'acc-1')).toBeNull();
  });

  it('returns the only member without querying deal load', async () => {
    const db = fakeDb({ members: [{ id: 'p-1' }] });
    expect(await pickRoundRobinDealAssignee(db, 'acc-1')).toBe('p-1');
  });

  it('picks the member with the fewest open deals', async () => {
    const db = fakeDb({
      members: [{ id: 'p-1' }, { id: 'p-2' }, { id: 'p-3' }],
      openDeals: [
        { assigned_to: 'p-1' },
        { assigned_to: 'p-1' },
        { assigned_to: 'p-2' },
      ],
    });
    // p-1: 2, p-2: 1, p-3: 0 -> p-3 has the lightest load.
    expect(await pickRoundRobinDealAssignee(db, 'acc-1')).toBe('p-3');
  });

  it('breaks ties by profile order, deterministically', async () => {
    const db = fakeDb({
      members: [{ id: 'p-1' }, { id: 'p-2' }],
      openDeals: [],
    });
    // Both at 0 — the first member (by created_at order) wins.
    expect(await pickRoundRobinDealAssignee(db, 'acc-1')).toBe('p-1');
  });

  it('spreads assignment across a simulated sequence of new deals', async () => {
    // Simulates what actually happens as create_deal runs repeatedly:
    // each pick should go to whoever is behind, converging to an even
    // split rather than piling onto one person.
    const members = [{ id: 'p-1' }, { id: 'p-2' }, { id: 'p-3' }];
    const assigned: string[] = [];
    for (let i = 0; i < 9; i++) {
      const openDeals = assigned.map((id) => ({ assigned_to: id }));
      const db = fakeDb({ members, openDeals });
      const pick = await pickRoundRobinDealAssignee(db, 'acc-1');
      assigned.push(pick as string);
    }
    const counts = members.map((m) => assigned.filter((id) => id === m.id).length);
    expect(counts).toEqual([3, 3, 3]);
  });

  it('ignores an open deal assigned to someone outside the account roster', async () => {
    // Defensive: a stale/cross-account assigned_to must not silently
    // skew the load count for a real member.
    const db = fakeDb({
      members: [{ id: 'p-1' }, { id: 'p-2' }],
      openDeals: [{ assigned_to: 'someone-else' }],
    });
    expect(await pickRoundRobinDealAssignee(db, 'acc-1')).toBe('p-1');
  });
});

describe('resolveAssigneeProfileId', () => {
  it('resolves an auth.users id (the AgentSelect picker value) to its profiles.id', async () => {
    const db = fakeDb({
      members: [],
      profilesByUserId: { 'user-1': { id: 'profile-1' } },
    });
    expect(await resolveAssigneeProfileId(db, 'acc-1', 'user-1')).toBe('profile-1');
  });

  it('returns null for a user id with no matching profile in this account', async () => {
    const db = fakeDb({ members: [], profilesByUserId: {} });
    expect(await resolveAssigneeProfileId(db, 'acc-1', 'user-404')).toBeNull();
  });
});
