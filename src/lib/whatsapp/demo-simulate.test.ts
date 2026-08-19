import { describe, expect, it, vi, beforeEach } from 'vitest';

const handleStatusUpdate = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);
const handleReaction = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);
const flagBroadcastReplyIfAny = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);
const writeEngagementEvent = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);
const findOrCreateConversation = vi.fn();
const reopenClosedConversation = vi.fn<
  (...args: unknown[]) => Promise<boolean>
>(async () => false);

vi.mock('@/lib/whatsapp/inbound-events', () => ({
  handleStatusUpdate: (...args: unknown[]) => handleStatusUpdate(...args),
  handleReaction: (...args: unknown[]) => handleReaction(...args),
  flagBroadcastReplyIfAny: (...args: unknown[]) =>
    flagBroadcastReplyIfAny(...args),
}));
vi.mock('@/lib/whatsapp/engagement', () => ({
  writeEngagementEvent: (...args: unknown[]) => writeEngagementEvent(...args),
}));
vi.mock('@/lib/whatsapp/find-or-create', () => ({
  findOrCreateConversation: (...args: unknown[]) =>
    findOrCreateConversation(...args),
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: (...args: unknown[]) =>
    reopenClosedConversation(...args),
}));

// Minimal Supabase-shaped fake covering exactly what
// simulateDemoInboundMessage touches: accounts (owner lookup) and
// messages (insert) + the bump_conversation_on_inbound RPC.
function fakeAdminDb(opts: {
  ownerUserId?: string | null;
  messageInsertError?: { message: string } | null;
  rpcError?: { message: string } | null;
}) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    inserted,
    from(table: string) {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  opts.ownerUserId === undefined
                    ? { owner_user_id: 'owner-1' }
                    : opts.ownerUserId === null
                      ? null
                      : { owner_user_id: opts.ownerUserId },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: () => ({
                single: async () =>
                  opts.messageInsertError
                    ? { data: null, error: opts.messageInsertError }
                    : { data: { id: 'msg-demo-1' }, error: null },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => ({
      error: opts.rpcError ?? null,
    }),
  };
  return db;
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => fakeAdminDbInstance,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fakeAdminDbInstance: any;

const {
  simulateDemoDeliveryAndRead,
  simulateDemoReaction,
  simulateDemoBroadcastReaction,
  simulateDemoInboundMessage,
} = await import('./demo-simulate');

beforeEach(() => {
  handleStatusUpdate.mockClear();
  handleReaction.mockClear();
  flagBroadcastReplyIfAny.mockClear();
  writeEngagementEvent.mockClear();
  findOrCreateConversation.mockReset();
  reopenClosedConversation.mockClear();
  fakeAdminDbInstance = fakeAdminDb({});
});

describe('simulateDemoDeliveryAndRead', () => {
  it('advances delivered then read, both tagged source: "demo"', async () => {
    await simulateDemoDeliveryAndRead('demo-wamid-1');
    expect(handleStatusUpdate).toHaveBeenCalledTimes(2);
    expect(handleStatusUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'demo-wamid-1', status: 'delivered' }),
      'demo'
    );
    expect(handleStatusUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'demo-wamid-1', status: 'read' }),
      'demo'
    );
  });

  it('swallows a handler failure rather than throwing', async () => {
    handleStatusUpdate.mockRejectedValueOnce(new Error('boom'));
    await expect(
      simulateDemoDeliveryAndRead('demo-wamid-1')
    ).resolves.toBeUndefined();
  });
});

describe('simulateDemoReaction', () => {
  it('calls handleReaction with source: "demo" and the given emoji', async () => {
    await simulateDemoReaction('demo-wamid-1', 'conv-1', 'contact-1', '🔥');
    expect(handleReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        reaction: { message_id: 'demo-wamid-1', emoji: '🔥' },
      }),
      'conv-1',
      'contact-1',
      'demo'
    );
  });

  it('defaults to a thumbs-up emoji', async () => {
    await simulateDemoReaction('demo-wamid-1', 'conv-1', 'contact-1');
    expect(handleReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        reaction: expect.objectContaining({ emoji: '👍' }),
      }),
      'conv-1',
      'contact-1',
      'demo'
    );
  });
});

describe('simulateDemoBroadcastReaction', () => {
  it('writes an engagement event directly, source: "demo", without going through handleReaction', async () => {
    await simulateDemoBroadcastReaction('acct-1', 'bc-1', 'contact-1', '🎉');
    expect(handleReaction).not.toHaveBeenCalled();
    expect(writeEngagementEvent).toHaveBeenCalledWith(
      fakeAdminDbInstance,
      expect.objectContaining({
        accountId: 'acct-1',
        memberId: 'contact-1',
        postId: 'bc-1',
        eventType: 'REACTION',
        source: 'demo',
        metadata: { emoji: '🎉' },
      })
    );
  });
});

describe('simulateDemoInboundMessage', () => {
  it('resolves the conversation, inserts a message, bumps + reopens it, and flags the reply as source: "demo"', async () => {
    findOrCreateConversation.mockResolvedValueOnce({
      conversation: { id: 'conv-1', status: 'open' },
      created: false,
    });

    await simulateDemoInboundMessage('acct-1', 'contact-1', 'Thanks!');

    expect(findOrCreateConversation).toHaveBeenCalledWith(
      'acct-1',
      'owner-1',
      'contact-1'
    );
    expect(fakeAdminDbInstance.inserted[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Thanks!',
      status: 'delivered',
    });
    expect(reopenClosedConversation).toHaveBeenCalledWith(fakeAdminDbInstance, {
      id: 'conv-1',
      status: 'open',
    });
    expect(flagBroadcastReplyIfAny).toHaveBeenCalledWith(
      'acct-1',
      'contact-1',
      'demo'
    );
  });

  it('picks a non-empty default reply text when none is given', async () => {
    findOrCreateConversation.mockResolvedValueOnce({
      conversation: { id: 'conv-1', status: 'open' },
      created: false,
    });
    await simulateDemoInboundMessage('acct-1', 'contact-1');
    const text = fakeAdminDbInstance.inserted[0].content_text as string;
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('bails out without throwing when the account has no resolvable owner', async () => {
    fakeAdminDbInstance = fakeAdminDb({ ownerUserId: null });
    await expect(
      simulateDemoInboundMessage('acct-1', 'contact-1', 'hi')
    ).resolves.toBeUndefined();
    expect(findOrCreateConversation).not.toHaveBeenCalled();
  });

  it('bails out without throwing when findOrCreateConversation fails', async () => {
    findOrCreateConversation.mockResolvedValueOnce(null);
    await expect(
      simulateDemoInboundMessage('acct-1', 'contact-1', 'hi')
    ).resolves.toBeUndefined();
    expect(flagBroadcastReplyIfAny).not.toHaveBeenCalled();
  });

  it('bails out without throwing when the message insert fails', async () => {
    fakeAdminDbInstance = fakeAdminDb({
      messageInsertError: { message: 'insert failed' },
    });
    findOrCreateConversation.mockResolvedValueOnce({
      conversation: { id: 'conv-1', status: 'open' },
      created: false,
    });
    await expect(
      simulateDemoInboundMessage('acct-1', 'contact-1', 'hi')
    ).resolves.toBeUndefined();
    expect(flagBroadcastReplyIfAny).not.toHaveBeenCalled();
  });
});
