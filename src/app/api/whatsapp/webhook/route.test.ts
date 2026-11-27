import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { from: vi.fn(), rpc: vi.fn() },
  deferred: [] as Array<() => Promise<void>>,
  dispatchWebhookEvent: vi.fn(async () => undefined),
  runAutomationsForTrigger: vi.fn(async () => undefined),
  dispatchInboundToFlows: vi.fn(async () => ({
    consumed: false,
    outcome: 'no_match',
  })),
  dispatchInboundToAiReply: vi.fn(async () => undefined),
}));

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (callback: () => Promise<void>) => mocks.deferred.push(callback),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.db }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'test-only-token',
  encrypt: () => 'encrypted',
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}));
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: async () => ({
    id: 'contact-1',
    name: 'Maria',
    phone: '5511999999999',
  }),
  isUniqueViolation: () => false,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getCatalogProductNames: async () => ({}),
  getMediaUrl: vi.fn(),
  sendTextMessage: vi.fn(),
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
}));
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: mocks.dispatchInboundToAiReply,
}));
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: mocks.dispatchWebhookEvent,
}));
vi.mock('@/lib/deals/auto-deal-lifecycle', () => ({
  ensureAutoDealForConversation: vi.fn(async () => undefined),
}));
vi.mock('@/lib/orders/text-order-flow', () => ({
  processFreeTextOrderInbound: vi.fn(async () => ({ handled: false })),
  processInboundHandoff: vi.fn(async () => ({
    requested: false,
    blocked: false,
  })),
}));

import { POST, shouldAttemptAiReply } from './route';

describe('shouldAttemptAiReply', () => {
  it('returns false for empty text', () => {
    expect(
      shouldAttemptAiReply({
        flowConsumed: false,
        interactiveReplyId: null,
        inboundText: '   ',
      })
    ).toBe(false);
  });

  it('returns false for interactive reply', () => {
    expect(
      shouldAttemptAiReply({
        flowConsumed: false,
        interactiveReplyId: 'button-1',
        inboundText: 'Oi',
      })
    ).toBe(false);
  });

  it('returns true when the flow did not consume a normal text message', () => {
    expect(
      shouldAttemptAiReply({
        flowConsumed: false,
        interactiveReplyId: null,
        inboundText: 'Olá, quero fazer um pedido',
      })
    ).toBe(true);
  });

  it('returns true when the flow ended in no_match', () => {
    expect(
      shouldAttemptAiReply({
        flowConsumed: true,
        outcome: 'no_match',
        interactiveReplyId: null,
        inboundText: 'Quero saber o preço',
      })
    ).toBe(true);
  });

  it('returns false when the flow already handled the message', () => {
    expect(
      shouldAttemptAiReply({
        flowConsumed: true,
        outcome: 'advanced',
        interactiveReplyId: null,
        inboundText: 'Quero saber o preço',
      })
    ).toBe(false);
  });
});

describe('POST /api/whatsapp/webhook — is_new & welcome gating', () => {
  type Row = Record<string, unknown>;
  let tables: Record<string, Row[]>;
  let rpcIsNew = true;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deferred.length = 0;
    rpcIsNew = true;
    tables = {
      whatsapp_config: [
        {
          account_id: 'account-1',
          user_id: 'owner-1',
          phone_number_id: 'phone-1',
          access_token: 'encrypted',
        },
      ],
      conversations: [
        {
          id: 'conv-1',
          account_id: 'account-1',
          user_id: 'owner-1',
          contact_id: 'contact-1',
          status: 'open',
          unread_count: 0,
          ai_reply_count: 2,
        },
      ],
      messages: [],
      whatsapp_inbound_receipts: [],
      broadcast_recipients: [],
    };

    mocks.db.rpc.mockImplementation(async (name: string) => {
      if (name === 'resolve_or_create_conversation') {
        return {
          data: {
            conversation: structuredClone(tables.conversations[0]),
            is_new: rpcIsNew,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    mocks.db.from.mockImplementation((table: string) => {
      let op = 'select';
      let payload: Row = {};
      const filters: Array<[string, unknown]> = [];
      const exec = () => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') {
          rows.push(structuredClone(payload));
          return { data: [payload], error: null };
        }
        const matched = rows.filter((r) =>
          filters.every(([k, v]) => r[k] === v)
        );
        if (op === 'update') {
          matched.forEach((r) => Object.assign(r, structuredClone(payload)));
        }
        return {
          data: structuredClone(matched),
          count: matched.length,
          error: null,
        };
      };
      const single = async () => {
        const r = exec();
        return { ...r, data: r.data?.[0] ?? null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        limit: () => q,
        order: () => q,
        in: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        insert: (p: Row) => ((op = 'insert'), (payload = p), q),
        update: (p: Row) => ((op = 'update'), (payload = p), q),
        maybeSingle: single,
        single,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(exec()).then(resolve),
      };
      return q;
    });
  });

  async function sendInbound(id: string) {
    const res = await POST(
      new Request('https://test.invalid/api/whatsapp/webhook', {
        method: 'POST',
        body: JSON.stringify({
          entry: [
            {
              id: 'waba-1',
              changes: [
                {
                  field: 'messages',
                  value: {
                    messaging_product: 'whatsapp',
                    metadata: {
                      phone_number_id: 'phone-1',
                      display_phone_number: '5511000000000',
                    },
                    contacts: [
                      { profile: { name: 'Maria' }, wa_id: '5511999999999' },
                    ],
                    messages: [
                      {
                        id,
                        from: '5511999999999',
                        timestamp: '1791856800',
                        type: 'text',
                        text: { body: 'Olá!' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    while (mocks.deferred.length) {
      await Promise.all(mocks.deferred.splice(0).map((cb) => cb()));
    }
  }

  it('dispatches conversation.created and first_inbound_message when is_new is true', async () => {
    rpcIsNew = true;
    await sendInbound('wamid-new-1');

    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'conversation.created',
      { conversation_id: 'conv-1', contact_id: 'contact-1' }
    );
    expect(mocks.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstInboundMessage: true })
    );
    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'first_inbound_message' })
    );
    expect(tables.conversations[0]).toMatchObject({
      last_message_text: 'Olá!',
      unread_count: 1,
    });
  });

  it('does not repeat conversation.created or first_inbound_message when is_new is false and customer already messaged', async () => {
    rpcIsNew = false;
    tables.messages.push({
      id: 'prior-msg',
      conversation_id: 'conv-1',
      sender_type: 'customer',
      content_text: 'Anterior',
    });

    await sendInbound('wamid-repeat-1');

    expect(mocks.dispatchWebhookEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'conversation.created',
      expect.anything()
    );
    expect(mocks.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstInboundMessage: false })
    );
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'first_inbound_message' })
    );
  });

  it('reopens closed -> open, skips conversation.created, and fires first_inbound_message if no prior customer message', async () => {
    rpcIsNew = false;
    tables.conversations[0].status = 'closed';
    tables.conversations[0].ai_reply_count = 3;

    await sendInbound('wamid-reopen-1');

    expect(tables.conversations[0]).toMatchObject({
      status: 'open',
      ai_reply_count: 0,
      unread_count: 1,
      last_message_text: 'Olá!',
    });
    expect(mocks.dispatchWebhookEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'conversation.created',
      expect.anything()
    );
    expect(mocks.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstInboundMessage: true })
    );
    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'first_inbound_message' })
    );
  });

  it('does not fire first_inbound_message when is_new is false and conversation status is pending', async () => {
    rpcIsNew = false;
    tables.conversations[0].status = 'pending';

    await sendInbound('wamid-pending-1');

    expect(mocks.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstInboundMessage: false })
    );
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'first_inbound_message' })
    );
  });
});
