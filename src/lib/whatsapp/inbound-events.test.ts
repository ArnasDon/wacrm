import { describe, expect, it, vi, beforeEach } from 'vitest';

// This file tests only the Phase 4 addition: EngagementEvent writes
// threaded through handleStatusUpdate / handleReaction /
// flagBroadcastReplyIfAny, and the `source` parameter that keeps a
// simulated event apart from a real one. The status-ladder /
// idempotency logic these functions already had is exercised
// indirectly via src/app/api/whatsapp/webhook/route.test.ts (that
// suite never reaches these particular code paths — it only covers
// inbound message processing, not status-update or reaction webhooks
// — hence a dedicated file here rather than duplicating coverage).

const writeEngagementEvent = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);
const dispatchWebhookEvent = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);

vi.mock('@/lib/whatsapp/engagement', () => ({
  writeEngagementEvent: (...args: unknown[]) => writeEngagementEvent(...args),
}));
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: (...args: unknown[]) => dispatchWebhookEvent(...args),
}));

interface Capture {
  table: string;
  row: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface TableHandler {
  maybeSingle?: () => { data: unknown; error: unknown };
  onUpdate?: (
    row: Record<string, unknown>,
    filters: Record<string, unknown>
  ) => { data: unknown; error: unknown };
  onUpsert?: (row: Record<string, unknown>) => { error: unknown };
  onDelete?: () => { error: unknown };
}

function fakeDb(handlers: Record<string, TableHandler>) {
  const captures: Capture[] = [];
  return {
    captures,
    from(table: string) {
      const h = handlers[table] ?? {};
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: (field: string, val: unknown) => {
          filters[field] = val;
          return chain;
        },
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (row: Record<string, unknown>) => {
          captures.push({ table, row, filters: { ...filters } });
          const res = h.onUpdate
            ? h.onUpdate(row, filters)
            : { data: [{ id: 'x' }], error: null };
          return {
            ...chain,
            then: (resolve: (r: unknown) => unknown) => resolve(res),
          };
        },
        upsert: (row: Record<string, unknown>) => {
          captures.push({ table, row, filters: { ...filters } });
          const res = h.onUpsert ? h.onUpsert(row) : { error: null };
          return {
            ...chain,
            then: (resolve: (r: unknown) => unknown) => resolve(res),
          };
        },
        delete: () => {
          const res = h.onDelete ? h.onDelete() : { error: null };
          return {
            ...chain,
            then: (resolve: (r: unknown) => unknown) => resolve(res),
          };
        },
        maybeSingle: async () =>
          h.maybeSingle ? h.maybeSingle() : { data: null, error: null },
        then: (resolve: (r: unknown) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => currentDb,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentDb: any;

const { handleStatusUpdate, handleReaction, flagBroadcastReplyIfAny } =
  await import('./inbound-events');

beforeEach(() => {
  writeEngagementEvent.mockClear();
  dispatchWebhookEvent.mockClear();
});

describe('handleStatusUpdate — engagement events', () => {
  it('writes a DELIVERED event tagged source: "whatsapp" by default for a broadcast-tied message', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({
          data: {
            id: 'rec-1',
            status: 'sent',
            broadcast_id: 'bc-1',
            contact_id: 'contact-1',
            broadcasts: { account_id: 'acct-1' },
          },
          error: null,
        }),
        onUpdate: () => ({ data: [{ id: 'rec-1' }], error: null }),
      },
    });

    await handleStatusUpdate({
      id: 'wamid-1',
      status: 'delivered',
      timestamp: '1700000000',
      recipient_id: '',
    });

    expect(writeEngagementEvent).toHaveBeenCalledWith(
      currentDb,
      expect.objectContaining({
        accountId: 'acct-1',
        memberId: 'contact-1',
        postId: 'bc-1',
        eventType: 'DELIVERED',
        source: 'whatsapp',
      })
    );
  });

  it('writes a READ event tagged source: "demo" when called with that source', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({
          data: {
            id: 'rec-1',
            status: 'delivered',
            broadcast_id: 'bc-1',
            contact_id: 'contact-1',
            broadcasts: { account_id: 'acct-1' },
          },
          error: null,
        }),
        onUpdate: () => ({ data: [{ id: 'rec-1' }], error: null }),
      },
    });

    await handleStatusUpdate(
      {
        id: 'demo-wamid-1',
        status: 'read',
        timestamp: '1700000000',
        recipient_id: '',
      },
      'demo'
    );

    expect(writeEngagementEvent).toHaveBeenCalledWith(
      currentDb,
      expect.objectContaining({ eventType: 'READ', source: 'demo' })
    );
  });

  it('does not write an engagement event for a "sent" transition', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({
          data: {
            id: 'rec-1',
            status: 'pending',
            broadcast_id: 'bc-1',
            contact_id: 'contact-1',
            broadcasts: { account_id: 'acct-1' },
          },
          error: null,
        }),
        onUpdate: () => ({ data: [{ id: 'rec-1' }], error: null }),
      },
    });

    await handleStatusUpdate({
      id: 'wamid-1',
      status: 'sent',
      timestamp: '1700000000',
      recipient_id: '',
    });

    expect(writeEngagementEvent).not.toHaveBeenCalled();
  });

  it('does not write an engagement event when the message is not a broadcast recipient (plain 1:1 message)', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({ data: null, error: null }),
      },
    });

    await handleStatusUpdate({
      id: 'wamid-1',
      status: 'delivered',
      timestamp: '1700000000',
      recipient_id: '',
    });

    expect(writeEngagementEvent).not.toHaveBeenCalled();
  });

  it('does not write an engagement event when the transition is invalid (ladder regression)', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({
          data: {
            id: 'rec-1',
            status: 'read', // already read
            broadcast_id: 'bc-1',
            contact_id: 'contact-1',
            broadcasts: { account_id: 'acct-1' },
          },
          error: null,
        }),
      },
    });

    await handleStatusUpdate({
      id: 'wamid-1',
      status: 'delivered', // regressing backward — rejected
      timestamp: '1700000000',
      recipient_id: '',
    });

    expect(writeEngagementEvent).not.toHaveBeenCalled();
  });

  it('persists Meta\'s failure reason onto broadcast_recipients.error_message (Phase 8 hardening)', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({
          data: {
            id: 'rec-1',
            status: 'sent',
            broadcast_id: 'bc-1',
            contact_id: 'contact-1',
            broadcasts: { account_id: 'acct-1' },
          },
          error: null,
        }),
        onUpdate: () => ({ data: [{ id: 'rec-1' }], error: null }),
      },
    });

    await handleStatusUpdate({
      id: 'wamid-1',
      status: 'failed',
      timestamp: '1700000000',
      recipient_id: '',
      errors: [
        { code: 131026, title: 'Message undeliverable', error_data: { details: 'Recipient not on WhatsApp' } },
      ],
    });

    const recipientUpdate = currentDb.captures.find(
      (c: { table: string }) => c.table === 'broadcast_recipients'
    );
    expect(recipientUpdate?.row).toMatchObject({
      status: 'failed',
      error_message: 'Message undeliverable (Recipient not on WhatsApp)',
    });
  });

  it('does not set error_message on a failed status with no errors array', async () => {
    currentDb = fakeDb({
      messages: { onUpdate: () => ({ data: [], error: null }) },
      broadcast_recipients: {
        maybeSingle: () => ({
          data: {
            id: 'rec-1',
            status: 'sent',
            broadcast_id: 'bc-1',
            contact_id: 'contact-1',
            broadcasts: { account_id: 'acct-1' },
          },
          error: null,
        }),
        onUpdate: () => ({ data: [{ id: 'rec-1' }], error: null }),
      },
    });

    await handleStatusUpdate({
      id: 'wamid-1',
      status: 'failed',
      timestamp: '1700000000',
      recipient_id: '',
    });

    const recipientUpdate = currentDb.captures.find(
      (c: { table: string }) => c.table === 'broadcast_recipients'
    );
    expect(recipientUpdate?.row.error_message).toBeUndefined();
  });
});

describe('handleReaction — engagement events', () => {
  it('writes a REACTION event with the resolved broadcast as postId when the target is a broadcast send', async () => {
    currentDb = fakeDb({
      messages: {
        maybeSingle: () => ({ data: { id: 'msg-internal-1' }, error: null }),
      },
      message_reactions: { onUpsert: () => ({ error: null }) },
      conversations: {
        maybeSingle: () => ({ data: { account_id: 'acct-1' }, error: null }),
      },
      broadcast_recipients: {
        maybeSingle: () => ({ data: { broadcast_id: 'bc-1' }, error: null }),
      },
    });

    await handleReaction(
      {
        id: 'ev-1',
        from: '',
        timestamp: '1700000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-1', emoji: '👍' },
      },
      'conv-1',
      'contact-1'
    );

    expect(writeEngagementEvent).toHaveBeenCalledWith(
      currentDb,
      expect.objectContaining({
        accountId: 'acct-1',
        memberId: 'contact-1',
        postId: 'bc-1',
        eventType: 'REACTION',
        source: 'whatsapp',
        metadata: { emoji: '👍' },
      })
    );
  });

  it('writes a REACTION event with postId null when the target message is not broadcast-tied', async () => {
    currentDb = fakeDb({
      messages: {
        maybeSingle: () => ({ data: { id: 'msg-internal-1' }, error: null }),
      },
      message_reactions: { onUpsert: () => ({ error: null }) },
      conversations: {
        maybeSingle: () => ({ data: { account_id: 'acct-1' }, error: null }),
      },
      broadcast_recipients: {
        maybeSingle: () => ({ data: null, error: null }),
      },
    });

    await handleReaction(
      {
        id: 'ev-1',
        from: '',
        timestamp: '1700000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-1', emoji: '👍' },
      },
      'conv-1',
      'contact-1',
      'demo'
    );

    expect(writeEngagementEvent).toHaveBeenCalledWith(
      currentDb,
      expect.objectContaining({ postId: null, source: 'demo' })
    );
  });

  it('does not write an engagement event on reaction removal (empty emoji)', async () => {
    currentDb = fakeDb({
      messages: {
        maybeSingle: () => ({ data: { id: 'msg-internal-1' }, error: null }),
      },
      message_reactions: { onDelete: () => ({ error: null }) },
    });

    await handleReaction(
      {
        id: 'ev-1',
        from: '',
        timestamp: '1700000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-1', emoji: '' },
      },
      'conv-1',
      'contact-1'
    );

    expect(writeEngagementEvent).not.toHaveBeenCalled();
  });

  it('does not write an engagement event when the target message was never received', async () => {
    currentDb = fakeDb({
      messages: { maybeSingle: () => ({ data: null, error: null }) },
    });

    await handleReaction(
      {
        id: 'ev-1',
        from: '',
        timestamp: '1700000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-1', emoji: '👍' },
      },
      'conv-1',
      'contact-1'
    );

    expect(writeEngagementEvent).not.toHaveBeenCalled();
  });
});

describe('flagBroadcastReplyIfAny — engagement events', () => {
  it('writes a REPLY event when an unreplied broadcast recipient is found and flipped', async () => {
    // flagBroadcastReplyIfAny's select chain ends in a bare-awaited
    // `.limit(...)`, not `.maybeSingle()` — a shape the generic
    // fakeDb() builder above doesn't cover, so this describe block
    // uses a small purpose-built db instead of reusing it.
    currentDb = {
      from(table: string) {
        if (table === 'broadcast_recipients') {
          const chain = {
            select: () => chain,
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () =>
              Promise.resolve({
                data: [{ id: 'rec-1', status: 'sent', broadcast_id: 'bc-1' }],
                error: null,
              }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
          return chain;
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };

    await flagBroadcastReplyIfAny('acct-1', 'contact-1');

    expect(writeEngagementEvent).toHaveBeenCalledWith(
      currentDb,
      expect.objectContaining({
        accountId: 'acct-1',
        memberId: 'contact-1',
        postId: 'bc-1',
        eventType: 'REPLY',
        source: 'whatsapp',
      })
    );
  });

  it('tags the event source: "demo" when called with that source', async () => {
    currentDb = {
      from(table: string) {
        if (table === 'broadcast_recipients') {
          const chain = {
            select: () => chain,
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () =>
              Promise.resolve({
                data: [{ id: 'rec-1', status: 'sent', broadcast_id: 'bc-1' }],
                error: null,
              }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
          return chain;
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };

    await flagBroadcastReplyIfAny('acct-1', 'contact-1', 'demo');

    expect(writeEngagementEvent).toHaveBeenCalledWith(
      currentDb,
      expect.objectContaining({ source: 'demo' })
    );
  });

  it('does not write an engagement event when there is nothing unreplied to flag', async () => {
    currentDb = {
      from(table: string) {
        if (table === 'broadcast_recipients') {
          const chain = {
            select: () => chain,
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () => Promise.resolve({ data: [], error: null }),
          };
          return chain;
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };

    await flagBroadcastReplyIfAny('acct-1', 'contact-1');

    expect(writeEngagementEvent).not.toHaveBeenCalled();
  });
});
