import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regression coverage for the 054 fix: create_content_broadcast_with_
// recipients returns one row per recipient (all sharing the same
// broadcast_id) for a multi-contact audience — a single-recipient
// audience never exercised that shape and is exactly why the
// ambiguous "contact_id" column reference (42702) shipped in 053
// unnoticed by this suite (db.rpc() is mocked here, same as
// everywhere else in this codebase — this test cannot execute the
// real PL/pgSQL, only pin down the app's side of the contract: what
// gets sent to the RPC, and how a real multi-row response gets turned
// into the route's response). The SQL-level bug itself is covered by
// the migration 054 fix; there is no local Postgres in this sandbox
// to add a live-database regression test for it (no docker/supabase
// CLI available), so that side relies on the .github/workflows/
// migrations.yml CI job replaying every migration from scratch.

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  resolveAudienceContacts: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

vi.mock('@/lib/content/audience', () => ({
  resolveAudienceContacts: mocks.resolveAudienceContacts,
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}));

const { POST } = await import('./route');

function makeSupabase(opts: {
  content: { id: string; title: string; status: string } | null;
  demoModeEnabled?: boolean;
}) {
  const contentUpdates: Record<string, unknown>[] = [];
  return {
    contentUpdates,
    from: (table: string) => {
      if (table === 'content') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: opts.content, error: null }),
          update: (values: Record<string, unknown>) => {
            contentUpdates.push(values);
            return chain;
          },
        };
        return chain;
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { demo_mode_enabled: opts.demoModeEnabled ?? true },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function params() {
  return { params: Promise.resolve({ id: 'ct-1' }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/content/ct-1/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.resolveAudienceContacts.mockReset();
  mocks.rpc.mockReset();
});

describe('POST /api/content/[id]/schedule', () => {
  it('schedules a multi-recipient audience: forwards every resolved contact_id to the RPC and reads broadcast_id off the first of many returned rows', async () => {
    const supabase = makeSupabase({
      content: { id: 'ct-1', title: 'Winter Oil Promo', status: 'Approved' },
    });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'user-1',
      accountId: 'acct-1',
    });

    const contacts = [
      { id: 'contact-1', phone: '+15550000001' },
      { id: 'contact-2', phone: '+15550000002' },
      { id: 'contact-3', phone: '+15550000003' },
    ];
    mocks.resolveAudienceContacts.mockResolvedValueOnce(contacts);

    // The real create_content_broadcast_with_recipients (post-054)
    // returns one row per recipient, all sharing the same
    // broadcast_id — this is the shape a single-recipient test would
    // never distinguish from a scalar return.
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          broadcast_id: 'bc-1',
          recipient_id: 'rec-1',
          contact_id: 'contact-1',
        },
        {
          broadcast_id: 'bc-1',
          recipient_id: 'rec-2',
          contact_id: 'contact-2',
        },
        {
          broadcast_id: 'bc-1',
          recipient_id: 'rec-3',
          contact_id: 'contact-3',
        },
      ],
      error: null,
    });

    const res = await POST(
      request({
        scheduled_at: '2026-09-01T09:00:00.000Z',
        audience: { roles: ['Mechanic'] },
      }),
      params()
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ broadcast_id: 'bc-1', recipient_count: 3 });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [, rpcArgs] = mocks.rpc.mock.calls[0];
    expect(rpcArgs.p_contact_ids).toEqual([
      'contact-1',
      'contact-2',
      'contact-3',
    ]);
    expect(rpcArgs.p_content_id).toBe('ct-1');

    // Content flips to Scheduled only after the RPC actually succeeds.
    expect(supabase.contentUpdates).toEqual([{ status: 'Scheduled' }]);
  });

  it('500s (without crashing) when the RPC reports a real Postgres error, e.g. the 054 ambiguous-column regression', async () => {
    const supabase = makeSupabase({
      content: { id: 'ct-1', title: 'Winter Oil Promo', status: 'Approved' },
    });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'user-1',
      accountId: 'acct-1',
    });
    mocks.resolveAudienceContacts.mockResolvedValueOnce([
      { id: 'contact-1', phone: '+15550000001' },
      { id: 'contact-2', phone: '+15550000002' },
    ]);
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'column reference "contact_id" is ambiguous',
        details:
          'It could refer to either a PL/pgSQL variable or a table column.',
        hint: null,
        code: '42702',
      },
    });

    const res = await POST(
      request({ scheduled_at: '2026-09-01T09:00:00.000Z', audience: {} }),
      params()
    );

    expect(res.status).toBe(500);
    // Never scheduled — the content status must not flip on a failed send.
    expect(supabase.contentUpdates).toEqual([]);
  });

  it('400s before ever calling the RPC when the audience resolves to nobody', async () => {
    const supabase = makeSupabase({
      content: { id: 'ct-1', title: 'Winter Oil Promo', status: 'Approved' },
    });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'user-1',
      accountId: 'acct-1',
    });
    mocks.resolveAudienceContacts.mockResolvedValueOnce([]);

    const res = await POST(
      request({ scheduled_at: '2026-09-01T09:00:00.000Z', audience: {} }),
      params()
    );

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
