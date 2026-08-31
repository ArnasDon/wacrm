import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
  mirrorInboundMedia: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  reopenClosedConversation: vi.fn(),
  findExistingContact: vi.fn(),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}));
vi.mock('@/lib/whatsapp/providers', () => ({
  createTransport: () => ({ fetchMedia: h.fetchMedia }),
}));
vi.mock('@/lib/whatsapp/mirror-inbound-media', () => ({
  mirrorInboundMedia: h.mirrorInboundMedia,
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: h.reopenClosedConversation,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}));
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}));
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.findExistingContact,
  isUniqueViolation: () => false,
}));

import { processInboundMessage } from './process-inbound-message';
import type { InboundMessage } from './types';

interface Setup {
  db: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  convs: Array<Record<string, unknown>>;
  state: {
    messageUpsertResult: { id: string }[];
    priorCustomerMsgCount: number;
    reactionTargetParent: { id: string } | null;
    connRow: Record<string, unknown> | null;
    messageUpserts: { row: Record<string, unknown>; options: unknown }[];
    reactionUpserts: { row: Record<string, unknown>; options: unknown }[];
    reactionDeletes: number;
    rpcCalls: { name: string; args: Record<string, unknown> }[];
  };
}

function setup(): Setup {
  const convs: Array<Record<string, unknown>> = [];
  let convSeq = 0;
  const state: Setup['state'] = {
    messageUpsertResult: [{ id: 'msg-1' }],
    priorCustomerMsgCount: 0,
    reactionTargetParent: null,
    connRow: {
      id: 'conn-1',
      account_id: 'acc-1',
      credential: 'enc',
      provider: 'meta',
      phone_number_id: 'pn-1',
      mirror_inbound_media: true,
    },
    messageUpserts: [],
    reactionUpserts: [],
    reactionDeletes: 0,
    rpcCalls: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    storage: {},
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      switch (table) {
        case 'contacts': {
          const c: Record<string, unknown> = {
            update: () => c,
            eq: () => Promise.resolve({ error: null }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: 'contact-new' }, error: null }),
              }),
            }),
          };
          return c;
        }
        case 'conversations': {
          const filters: Record<string, unknown> = {};
          const builder: Record<string, unknown> = {
            select: () => builder,
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return builder;
            },
            order: () => builder,
            limit: () =>
              Promise.resolve({
                data: convs
                  .filter(
                    (row) =>
                      (filters.account_id === undefined ||
                        row.account_id === filters.account_id) &&
                      (filters.contact_id === undefined ||
                        row.contact_id === filters.contact_id) &&
                      (filters.connection_id === undefined ||
                        row.connection_id === filters.connection_id)
                  )
                  .slice(0, 1),
                error: null,
              }),
            insert: (rowData: Record<string, unknown>) => ({
              select: () => ({
                single: () => {
                  const rec = {
                    id: `conv-${++convSeq}`,
                    status: 'open',
                    ...rowData,
                  };
                  convs.push(rec);
                  return Promise.resolve({ data: rec, error: null });
                },
              }),
            }),
          };
          return builder;
        }
        case 'messages': {
          return {
            select: (_cols: string, options?: { head?: boolean }) =>
              options?.head
                ? {
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({
                          count: state.priorCustomerMsgCount,
                          error: null,
                        }),
                    }),
                  }
                : {
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: state.reactionTargetParent,
                            error: null,
                          }),
                      }),
                    }),
                  },
            upsert: (row: Record<string, unknown>, options: unknown) => {
              state.messageUpserts.push({ row, options });
              return {
                select: () =>
                  Promise.resolve({
                    data: state.messageUpsertResult,
                    error: null,
                  }),
              };
            },
          };
        }
        case 'message_reactions': {
          return {
            upsert: (row: Record<string, unknown>, options: unknown) => {
              state.reactionUpserts.push({ row, options });
              return Promise.resolve({ error: null });
            },
            delete: () => {
              const d: Record<string, unknown> = {
                eq: () => d,
                then: (
                  res: (v: { error: null }) => unknown,
                  rej?: (r: unknown) => unknown
                ) => {
                  state.reactionDeletes++;
                  return Promise.resolve({ error: null }).then(res, rej);
                },
              };
              return d;
            },
          };
        }
        case 'whatsapp_connections': {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: state.connRow, error: null }),
              }),
            }),
          };
        }
        case 'broadcast_recipients': {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
  };

  return { db, convs, state };
}

function textMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    connectionId: 'conn-1',
    accountId: 'acc-1',
    configOwnerUserId: 'user-1',
    providerMessageId: 'wamid.1',
    from: '15551230000',
    senderName: 'Ada',
    timestamp: new Date(1700000000 * 1000),
    content: { kind: 'text', text: 'hello' },
    ...overrides,
  };
}

const MEDIA_CONTENT: InboundMessage['content'] = {
  kind: 'media',
  mediaKind: 'image',
  caption: 'hi',
  mimeType: 'image/jpeg',
  ref: { provider: 'meta', mediaId: 'mid-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findExistingContact.mockResolvedValue({
    id: 'contact-1',
    name: 'Ada',
    phone: '15551230000',
  });
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false });
  h.dispatchInboundToAiReply.mockResolvedValue(undefined);
  h.dispatchWebhookEvent.mockResolvedValue(undefined);
  h.reopenClosedConversation.mockResolvedValue(false);
  h.runAutomationsForTrigger.mockResolvedValue(undefined);
  h.fetchMedia.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/jpeg',
  });
  h.mirrorInboundMedia.mockResolvedValue(
    'https://cdn.test/chat-media/account-acc-1/inbound/mid-1-image-1700000000.jpg'
  );
});

describe('processInboundMessage — text', () => {
  it('persists the message and fans out downstream', async () => {
    const { db, state } = setup();

    await processInboundMessage(db, textMsg());

    expect(state.messageUpserts).toHaveLength(1);
    expect(state.messageUpserts[0].row).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'hello',
      media_url: null,
      media_type: null,
      message_id: 'wamid.1',
      status: 'delivered',
      created_at: new Date(1700000000 * 1000).toISOString(),
      interactive_reply_id: null,
    });
    expect(state.messageUpserts[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    });

    expect(state.rpcCalls).toEqual([
      {
        name: 'bump_conversation_on_inbound',
        args: { p_conversation_id: 'conv-1', p_last_message_text: 'hello' },
      },
    ]);
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1);
    expect(h.dispatchInboundToAiReply).toHaveBeenCalledTimes(1);
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      db,
      'acc-1',
      'message.received',
      expect.objectContaining({
        conversation_id: 'conv-1',
        whatsapp_message_id: 'wamid.1',
        content_type: 'text',
        text: 'hello',
      })
    );
  });

  it('emits conversation.created before anything else when the thread is new', async () => {
    const { db } = setup();

    await processInboundMessage(db, textMsg());

    expect(h.dispatchWebhookEvent).toHaveBeenNthCalledWith(
      1,
      db,
      'acc-1',
      'conversation.created',
      { conversation_id: 'conv-1', contact_id: 'contact-1' }
    );
  });
});

describe('processInboundMessage — idempotent replay', () => {
  it('is a no-op when the upsert reports a conflict (empty select)', async () => {
    const { db, state } = setup();
    state.messageUpsertResult = [];

    await processInboundMessage(db, textMsg());

    expect(state.messageUpserts).toHaveLength(1);
    expect(state.rpcCalls).toHaveLength(0);
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalledWith(
      db,
      'acc-1',
      'message.received',
      expect.anything()
    );
  });
});

describe('processInboundMessage — reaction', () => {
  it('upserts message_reactions and never touches messages', async () => {
    const { db, state } = setup();
    state.reactionTargetParent = { id: 'parent-1' };

    await processInboundMessage(
      db,
      textMsg({
        providerMessageId: 'wamid.react',
        content: {
          kind: 'reaction',
          targetProviderMessageId: 'wamid.parent',
          emoji: '👍',
        },
      })
    );

    expect(state.reactionUpserts).toHaveLength(1);
    expect(state.reactionUpserts[0].row).toMatchObject({
      message_id: 'parent-1',
      conversation_id: 'conv-1',
      actor_type: 'customer',
      actor_id: 'contact-1',
      emoji: '👍',
    });
    expect(state.messageUpserts).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
  });

  it('deletes the reaction row when the emoji is empty (removal)', async () => {
    const { db, state } = setup();
    state.reactionTargetParent = { id: 'parent-1' };

    await processInboundMessage(
      db,
      textMsg({
        content: {
          kind: 'reaction',
          targetProviderMessageId: 'wamid.parent',
          emoji: '',
        },
      })
    );

    expect(state.reactionDeletes).toBe(1);
    expect(state.reactionUpserts).toHaveLength(0);
  });
});

describe('processInboundMessage — media', () => {
  it('fetches bytes via the transport, mirrors them, and stores the durable URL', async () => {
    const { db, state } = setup();

    await processInboundMessage(db, textMsg({ content: MEDIA_CONTENT }));

    expect(h.fetchMedia).toHaveBeenCalledWith({
      provider: 'meta',
      mediaId: 'mid-1',
    });
    expect(h.mirrorInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        mediaId: 'mid-1',
        mimeType: 'image/jpeg',
        fileSize: 3,
        messageTimestamp: '1700000000',
      })
    );
    expect(state.messageUpserts[0].row).toMatchObject({
      content_type: 'image',
      content_text: 'hi',
      media_url:
        'https://cdn.test/chat-media/account-acc-1/inbound/mid-1-image-1700000000.jpg',
      media_type: 'image/jpeg',
    });
  });

  it('falls back to the proxy URL when the mirror returns null', async () => {
    const { db, state } = setup();
    h.mirrorInboundMedia.mockResolvedValue(null);

    await processInboundMessage(db, textMsg({ content: MEDIA_CONTENT }));

    expect(state.messageUpserts[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/mid-1',
      media_type: 'image/jpeg',
    });
  });

  it('falls back to the proxy URL when fetchMedia throws (best-effort)', async () => {
    const { db, state } = setup();
    h.fetchMedia.mockRejectedValue(new Error('media too big'));

    await processInboundMessage(db, textMsg({ content: MEDIA_CONTENT }));

    expect(h.mirrorInboundMedia).not.toHaveBeenCalled();
    expect(state.messageUpserts[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/mid-1',
      media_type: 'image/jpeg',
    });
  });

  it('keeps the proxy URL and skips the transport when the account opted out', async () => {
    const { db, state } = setup();
    state.connRow = { ...state.connRow!, mirror_inbound_media: false };

    await processInboundMessage(db, textMsg({ content: MEDIA_CONTENT }));

    expect(h.fetchMedia).not.toHaveBeenCalled();
    expect(h.mirrorInboundMedia).not.toHaveBeenCalled();
    expect(state.messageUpserts[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/mid-1',
      media_type: 'image/jpeg',
    });
  });

  it('uazapi media: mirror key is the providerMessageId, not "" (FIX 3 — no cross-contact collision)', async () => {
    const { db, state } = setup();
    state.connRow = {
      id: 'conn-1',
      account_id: 'acc-1',
      credential: 'enc',
      provider: 'uazapi',
      uazapi_instance_id: 'inst-1',
      uazapi_base_url: 'https://pinned.uazapi.example',
      mirror_inbound_media: true,
    };
    h.mirrorInboundMedia.mockResolvedValue(
      'https://cdn.test/chat-media/account-acc-1/inbound/3EB0ABC-invoice.pdf'
    );
    const uazapiMedia: InboundMessage['content'] = {
      kind: 'media',
      mediaKind: 'document',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      ref: { provider: 'uazapi', messageId: '3EB0ABC' },
    };

    await processInboundMessage(
      db,
      textMsg({ providerMessageId: '3EB0ABC', content: uazapiMedia })
    );

    expect(h.mirrorInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: '3EB0ABC' })
    );
    // Two different messages carrying the same filename get distinct keys.
    h.mirrorInboundMedia.mockClear();
    await processInboundMessage(
      db,
      textMsg({ providerMessageId: '3EB0XYZ', content: uazapiMedia })
    );
    expect(h.mirrorInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: '3EB0XYZ' })
    );
  });
});

describe('processInboundMessage — unsupported', () => {
  it('stores the bracketed placeholder as text', async () => {
    const { db, state } = setup();

    await processInboundMessage(
      db,
      textMsg({ content: { kind: 'unsupported', rawType: 'contacts' } })
    );

    expect(state.messageUpserts[0].row).toMatchObject({
      content_type: 'text',
      content_text: '[Unsupported message type: contacts]',
    });
    expect(state.rpcCalls[0].args.p_last_message_text).toBe(
      '[Unsupported message type: contacts]'
    );
  });
});

describe('processInboundMessage — connection-aware conversations', () => {
  it('opens a separate conversation per connectionId for the same contact', async () => {
    const { db, convs } = setup();

    await processInboundMessage(
      db,
      textMsg({ connectionId: 'conn-A', providerMessageId: 'w.A' })
    );
    await processInboundMessage(
      db,
      textMsg({ connectionId: 'conn-B', providerMessageId: 'w.B' })
    );

    const forContact = convs.filter((c) => c.contact_id === 'contact-1');
    expect(forContact).toHaveLength(2);
    expect(forContact.map((c) => c.connection_id).sort()).toEqual([
      'conn-A',
      'conn-B',
    ]);

    // A third inbound on conn-A resolves the existing thread, no new row.
    await processInboundMessage(
      db,
      textMsg({ connectionId: 'conn-A', providerMessageId: 'w.A2' })
    );
    expect(convs).toHaveLength(2);
  });
});
