import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { from: vi.fn(), rpc: vi.fn() },
  deferred: [] as Array<() => Promise<void>>,
  flow: vi.fn(),
  ai: vi.fn(),
  payment: vi.fn(),
  text: vi.fn(),
  autoDeal: vi.fn(),
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
    id: 'contact',
    name: 'Maria',
    phone: '5511999999999',
  }),
  isUniqueViolation: () => false,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getCatalogProductNames: async () => ({}),
  getMediaUrl: vi.fn(),
  sendTextMessage: mocks.text,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: async () => undefined,
}));
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: mocks.flow }));
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: mocks.ai }));
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: async () => undefined,
}));
vi.mock('@/lib/deals/auto-deal-lifecycle', () => ({
  ensureAutoDealForConversation: mocks.autoDeal,
}));
vi.mock('@/lib/orders/create-order-with-mercado-pago', () => ({
  createOrderWithMercadoPago: mocks.payment,
}));
vi.mock('@/lib/orders/create-order', () => ({
  applyContactTag: async () => undefined,
  TAG_HUMANO: 'Precisa de Atendente',
}));
vi.mock('@/lib/orders/custom-fields', () => ({
  getSavedCustomerAddress: async () => null,
  saveContactOrderFields: async () => undefined,
}));

import { POST } from './route';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let oldDraft: Row;
let failMessageInsert: boolean | string = false;
let failReceiptInsert: boolean | string = false;
function resolveConversationRpc(
  name: string,
  args: Record<string, unknown>
) {
  if (name !== 'resolve_or_create_conversation') return null;
  const existing = tables.conversations.find(
    (c) =>
      c.account_id === args.p_account_id && c.contact_id === args.p_contact_id
  );
  if (existing) {
    return {
      data: { conversation: structuredClone(existing), is_new: false },
      error: null,
    };
  }
  const created = {
    id: `conv-${tables.conversations.length + 1}`,
    account_id: args.p_account_id,
    user_id: args.p_user_id,
    contact_id: args.p_contact_id,
    status: args.p_status ?? 'open',
    unread_count: 0,
  };
  tables.conversations.push(created);
  return {
    data: { conversation: structuredClone(created), is_new: true },
    error: null,
  };
}

function database() {
  return (table: string) => {
    let operation = 'select';
    let payload: Row = {};
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      const rows = (tables[table] ??= []);
      if (operation === 'insert') {
        if (
          table === 'whatsapp_inbound_receipts' &&
          (failReceiptInsert === true ||
            failReceiptInsert === payload.meta_message_id)
        )
          return { data: null, error: { code: '08006' } };
        if (
          table === 'messages' &&
          (failMessageInsert === true ||
            failMessageInsert === payload.message_id)
        )
          return { data: null, error: { code: '08006' } };
        if (
          table === 'messages' &&
          rows.some(
            (r) =>
              r.conversation_id === payload.conversation_id &&
              r.message_id === payload.message_id
          )
        )
          return { data: null, error: { code: '23505' } };
        if (
          table === 'whatsapp_inbound_receipts' &&
          rows.some(
            (r) =>
              r.account_id === payload.account_id &&
              r.meta_message_id === payload.meta_message_id
          )
        )
          return { data: null, error: { code: '23505' } };
        rows.push(structuredClone(payload));
        return { data: [payload], error: null };
      }
      const matched = rows.filter((row) =>
        filters.every(([key, value]) => row[key] === value)
      );
      if (operation === 'update')
        matched.forEach((row) => Object.assign(row, structuredClone(payload)));
      return {
        data: structuredClone(matched),
        count: matched.length,
        error: null,
      };
    };
    const single = async () => {
      const r = result();
      return { ...r, data: r.data?.[0] ?? null };
    };
    const q = {
      select: () => q,
      limit: () => q,
      order: () => q,
      in: () => q,
      eq: (key: string, value: unknown) => (filters.push([key, value]), q),
      insert: (value: Row) => ((operation = 'insert'), (payload = value), q),
      update: (value: Row) => ((operation = 'update'), (payload = value), q),
      maybeSingle: single,
      single,
      then: (resolve: (r: ReturnType<typeof result>) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return q;
  };
}
async function deliver(
  id: string,
  content: Row,
  expectedStatus = 200,
  flushEffects = true
) {
  await deliverBatch([{ id, ...content }], expectedStatus, flushEffects);
}
async function flushAfterConcurrently() {
  while (mocks.deferred.length)
    await Promise.all(mocks.deferred.splice(0).map((callback) => callback()));
}
async function deliverBatch(
  messages: Row[],
  expectedStatus = 200,
  flushEffects = true
) {
  const response = await POST(
    new Request('https://test.invalid/api/whatsapp/webhook', {
      method: 'POST',
      body: JSON.stringify({
        entry: [
          {
            id: 'waba',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    phone_number_id: 'phone',
                    display_phone_number: '5511000000000',
                  },
                  contacts: [
                    { profile: { name: 'Maria' }, wa_id: '5511999999999' },
                  ],
                  messages: messages.map((message) => ({
                    from: '5511999999999',
                    timestamp: '1791856800',
                    ...message,
                  })),
                },
              },
            ],
          },
        ],
      }),
    })
  );
  expect(response.status).toBe(expectedStatus);
  if (expectedStatus === 200)
    for (const message of messages)
      expect(tables.messages.some((m) => m.message_id === message.id)).toBe(
        true
      );
  if (flushEffects) await flushAfterConcurrently();
}
beforeEach(() => {
  failMessageInsert = false;
  failReceiptInsert = false;
  vi.clearAllMocks();
  mocks.deferred.length = 0;
  oldDraft = {
    id: 'old-draft',
    version: 2,
    stage: 'payment_created',
    items: [],
    unresolved: [],
    total: 28,
  };
  tables = {
    whatsapp_config: [
      {
        account_id: 'account',
        user_id: 'owner',
        phone_number_id: 'phone',
        access_token: 'encrypted',
      },
    ],
    conversations: [
      {
        id: 'conversation',
        account_id: 'account',
        contact_id: 'contact',
        status: 'open',
        unread_count: 0,
      },
    ],
    order_drafts: [
      {
        account_id: 'account',
        conversation_id: 'conversation',
        state: structuredClone(oldDraft),
      },
    ],
    flow_runs: [],
    messages: [],
    whatsapp_inbound_receipts: [],
    broadcast_recipients: [],
  };
  mocks.db.from.mockImplementation(database());
  mocks.db.rpc.mockImplementation(async (name, args) => {
    const resolved = resolveConversationRpc(name, args);
    if (resolved) return resolved;
    throw new Error('A catalog reply must not acquire an old text-draft turn');
  });
  mocks.flow.mockImplementation(async (input) => {
    if (input.message.kind === 'catalog_order')
      tables.flow_runs.push({
        id: 'new-catalog-run',
        account_id: 'account',
        conversation_id: 'conversation',
        status: 'active',
        vars: {
          catalog_order_version: 1,
          itens: [
            {
              id: 'emp_hamburguer',
              title: 'Carne',
              quantity: 2,
              unitPrice: 14,
            },
          ],
        },
      });
    return { consumed: true, outcome: 'advanced' };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('No network in webhook routing regressions');
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('real WhatsApp POST and text processor ownership', () => {
  it('routes a catalog-validated native order over a manual/recent-human pause once, preserving notes and the old payment', async () => {
    const sku = '00000000-0000-0000-0000-000000000009';
    tables.menu_items = [
      {
        id: sku,
        account_id: 'account',
        name: 'Carne',
        price: 14,
        is_available: true,
      },
    ];
    Object.assign(tables.conversations[0], {
      ai_autoreply_disabled: true,
      bot_pause_reason: 'manual',
      last_agent_message_at: new Date(Date.now() - 60000).toISOString(),
    });
    mocks.db.rpc.mockImplementation(async (name, args) => {
      const resolved = resolveConversationRpc(name, args);
      if (resolved) return resolved;
      expect(name).toBe('handle_conversation_handoff');
      if (args.p_new_order === true && args.p_request === false) {
        Object.assign(tables.conversations[0], {
          ai_autoreply_disabled: false,
          bot_pause_reason: null,
          status: 'open',
          bot_order_resumed_at: new Date().toISOString(),
        });
        return { data: { blocked: false, resumed: true }, error: null };
      }
      return { data: { blocked: true }, error: null };
    });
    const cart = {
      type: 'order',
      order: {
        text: 'sem pimentão',
        product_items: [
          {
            product_retailer_id: sku,
            quantity: 2,
            item_price: 0.01,
            currency: 'BRL',
          },
        ],
      },
    };
    await deliver('priority-native', cart);
    await deliver('priority-native', cart);
    expect(mocks.db.rpc).toHaveBeenCalledWith(
      'handle_conversation_handoff',
      expect.objectContaining({ p_new_order: true, p_request: false })
    );
    expect(mocks.flow).toHaveBeenCalledTimes(1);
    expect(mocks.flow.mock.calls[0][0].message).toMatchObject({
      kind: 'catalog_order',
      notes: 'sem pimentão',
      items: [expect.objectContaining({ retailer_id: sku, quantity: 2 })],
    });
    expect(tables.order_drafts[0].state).toEqual(oldDraft);
    expect(tables.whatsapp_inbound_receipts).toHaveLength(1);
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5])(
    'does not grant native priority to invalid quantity %s',
    async (quantity) => {
      const sku = '00000000-0000-0000-0000-000000000009';
      tables.menu_items = [
        {
          id: sku,
          account_id: 'account',
          name: 'Carne',
          price: 14,
          is_available: true,
        },
      ];
      tables.conversations[0].ai_autoreply_disabled = true;
      mocks.db.rpc.mockImplementation(async (name, args) => {
        const resolved = resolveConversationRpc(name, args);
        if (resolved) return resolved;
        return { data: { blocked: true }, error: null };
      });
      await deliver('invalid-native', {
        type: 'order',
        order: {
          product_items: [
            { product_retailer_id: sku, quantity, item_price: 14 },
          ],
        },
      });
      expect(mocks.db.rpc).toHaveBeenCalledWith(
        'handle_conversation_handoff',
        expect.objectContaining({ p_new_order: false })
      );
      expect(mocks.flow).not.toHaveBeenCalled();
      expect(mocks.payment).not.toHaveBeenCalled();
    }
  );
  const media = {
    type: 'image',
    image: { id: 'media', mime_type: 'image/png' },
  };
  it('returns a retryable error when inbound account routing is unavailable', async () => {
    tables.whatsapp_config = [];
    await deliver('no-config', media, 500);
    expect(tables.messages).toHaveLength(0);
    expect(mocks.deferred).toHaveLength(0);
  });
  it('saves history before HTTP 200 while deferring slow business effects', async () => {
    await deliver('before-ack', media, 200, false);
    expect(tables.messages).toHaveLength(1);
    expect(mocks.flow).not.toHaveBeenCalled();
    expect(mocks.deferred).toHaveLength(1);
    await deliver('before-ack', media);
    expect(mocks.flow).toHaveBeenCalledTimes(1);
    expect(tables.conversations[0].unread_count).toBe(1);
  });
  it('awaits each message in the same conversation even when after callbacks run concurrently', async () => {
    tables.flow_runs.push({
      account_id: 'account',
      conversation_id: 'conversation',
      status: 'active',
      vars: { catalog_order_version: 1, itens: [] },
    });
    const messages = [
      { id: 'batch-items', type: 'text', text: { body: 'Delivery' } },
      {
        id: 'batch-address',
        type: 'text',
        text: { body: 'Rua das Flores, 10' },
      },
    ];
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let notifyStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const events: string[] = [];
    mocks.flow.mockImplementation(async (input) => {
      const id = input.message.meta_message_id;
      events.push(`start:${id}`);
      if (id === 'batch-items') {
        notifyStarted();
        await firstFinished;
      }
      events.push(`end:${id}`);
      return { consumed: true, outcome: 'advanced' };
    });

    await deliverBatch(messages, 200, false);
    expect(tables.messages).toHaveLength(2);
    expect(tables.whatsapp_inbound_receipts).toHaveLength(2);
    expect(mocks.flow).not.toHaveBeenCalled();
    const effects = flushAfterConcurrently();
    await firstStarted;
    // Drain the remaining ready callbacks while the first turn is blocked.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const eventsWhileFirstBlocked = [...events];
    releaseFirst();
    await effects;
    expect(eventsWhileFirstBlocked).toEqual(['start:batch-items']);
    expect(events).toEqual([
      'start:batch-items',
      'end:batch-items',
      'start:batch-address',
      'end:batch-address',
    ]);
    await deliverBatch(messages);
    expect(mocks.flow).toHaveBeenCalledTimes(2);
    expect(tables.messages).toHaveLength(2);
    expect(tables.conversations[0].unread_count).toBe(2);
  });
  it.each(['history', 'receipt'])(
    'still runs earlier reserved effects when a later message fails %s persistence',
    async (failure) => {
      const messages = [
        { id: 'batch-saved', ...media },
        { id: 'batch-failed', ...media },
      ];
      if (failure === 'history') failMessageInsert = 'batch-failed';
      else failReceiptInsert = 'batch-failed';
      await deliverBatch(messages, 500, false);
      expect(tables.whatsapp_inbound_receipts).toHaveLength(1);
      expect(mocks.flow).not.toHaveBeenCalled();
      expect(mocks.deferred).toHaveLength(1);
      await flushAfterConcurrently();
      expect(mocks.flow).toHaveBeenCalledTimes(1);
      expect(mocks.flow.mock.calls[0][0].message.meta_message_id).toBe(
        'batch-saved'
      );

      failMessageInsert = false;
      failReceiptInsert = false;
      await deliverBatch(messages);
      await deliverBatch(messages);
      expect(tables.messages).toHaveLength(2);
      expect(tables.whatsapp_inbound_receipts).toHaveLength(2);
      expect(tables.conversations[0].unread_count).toBe(2);
      expect(
        mocks.flow.mock.calls.map(([input]) => input.message.meta_message_id)
      ).toEqual(['batch-saved', 'batch-failed']);
    }
  );
  it('continues the batch after an uncertain business effect without replaying it on retry', async () => {
    mocks.flow.mockRejectedValueOnce(new Error('first turn stopped'));
    const messages = [
      { id: 'batch-uncertain', ...media },
      { id: 'batch-next', ...media },
    ];
    await deliverBatch(messages);
    await deliverBatch(messages);
    expect(
      mocks.flow.mock.calls.map(([input]) => input.message.meta_message_id)
    ).toEqual(['batch-uncertain', 'batch-next']);
    expect(tables.messages).toHaveLength(2);
  });
  it('recovers a failed receipt claim without duplicating persisted history', async () => {
    failReceiptInsert = true;
    await deliver('receipt-retry', media, 500);
    expect(tables.messages).toHaveLength(1);
    expect(mocks.flow).not.toHaveBeenCalled();
    failReceiptInsert = false;
    await deliver('receipt-retry', media);
    await deliver('receipt-retry', media);
    expect(tables.messages).toHaveLength(1);
    expect(tables.conversations[0].unread_count).toBe(1);
    expect(mocks.flow).toHaveBeenCalledTimes(1);
  });
  it('claims only one business attempt for concurrent deliveries', async () => {
    await Promise.all([
      deliver('racing', media, 200, false),
      deliver('racing', media, 200, false),
    ]);
    expect(tables.messages).toHaveLength(1);
    expect(tables.whatsapp_inbound_receipts).toHaveLength(1);
    expect(mocks.deferred).toHaveLength(1);
    await mocks.deferred.shift()!();
    expect(mocks.flow).toHaveBeenCalledTimes(1);
  });
  it('does not replay an uncertain business effect after it throws', async () => {
    mocks.flow.mockRejectedValueOnce(new Error('worker stopped'));
    await deliver('uncertain', media);
    await deliver('uncertain', media);
    expect(mocks.flow).toHaveBeenCalledTimes(1);
    expect(tables.messages).toHaveLength(1);
  });
  it.each([false, true])(
    'blocks native catalog automation for a human episode (RPC fails: %s)',
    async (fails) => {
      tables.conversations[0].status = 'pending';
      mocks.db.rpc.mockImplementation(async (name, args) => {
        const resolved = resolveConversationRpc(name, args);
        if (resolved) return resolved;
        if (fails) throw new Error('handoff unavailable');
        return { data: { blocked: true }, error: null };
      });
      await deliver('human-cart', {
        type: 'order',
        order: {
          product_items: [
            {
              product_retailer_id: 'emp_hamburguer',
              quantity: 1,
              item_price: 14,
            },
          ],
        },
      });
      expect(mocks.db.rpc).toHaveBeenCalledWith(
        'handle_conversation_handoff',
        expect.objectContaining({
          p_account_id: 'account',
          p_conversation_id: 'conversation',
        })
      );
      expect(mocks.flow).not.toHaveBeenCalled();
      expect(mocks.ai).not.toHaveBeenCalled();
      expect(tables.messages).toHaveLength(1);
    }
  );
  it('repairs history behind a legacy receipt without repeating business effects', async () => {
    const legacyPayload = { id: 'legacy-original', text: { body: 'Evidence' } };
    tables.whatsapp_inbound_receipts.push({
      account_id: 'account',
      meta_message_id: 'legacy',
      payload: legacyPayload,
    });
    tables.conversations[0].status = 'closed';
    tables.conversations[0].ai_reply_count = 7;
    const priorConversation = structuredClone(tables.conversations[0]);
    await deliver('legacy', {
      type: 'interactive',
      interactive: { button_reply: { id: 'x', title: 'Hi' } },
    });
    expect(tables.messages).toHaveLength(1);
    expect(tables.whatsapp_inbound_receipts[0].payload).toEqual(legacyPayload);
    expect(tables.conversations[0]).toEqual(priorConversation);
    expect(mocks.flow).not.toHaveBeenCalled();
    await deliver('legacy', {
      type: 'interactive',
      interactive: { button_reply: { id: 'x', title: 'Hi' } },
    });
    expect(tables.messages).toHaveLength(1);
  });
  it('returns retryable failure when history cannot persist, then recovers once', async () => {
    const content = {
      type: 'image',
      image: { id: 'retry-media', mime_type: 'image/png' },
    };
    failMessageInsert = true;
    await deliver('retry', content, 500);
    expect(tables.whatsapp_inbound_receipts).toHaveLength(0);
    failMessageInsert = false;
    await deliver('retry', content);
    await deliver('retry', content);
    expect(tables.messages).toHaveLength(1);
    expect(mocks.flow).toHaveBeenCalledTimes(1);
  });
  it('does not create a deal for a greeting without order intent', async () => {
    await deliver('greeting', {
      type: 'interactive',
      interactive: { button_reply: { id: 'hello', title: 'Bom dia' } },
    });
    expect(mocks.autoDeal).not.toHaveBeenCalled();
  });
  it('does not create a deal for non-order media', async () => {
    await deliver('non-order', {
      type: 'image',
      image: { id: 'media', mime_type: 'image/png' },
    });
    expect(mocks.autoDeal).not.toHaveBeenCalled();
  });
  it.each(['button_reply', 'list_reply'])(
    'passes the original Meta prompt id to the engine for %s even without an internal message row',
    async (type) => {
      tables.flow_runs.push({
        account_id: 'account',
        conversation_id: 'conversation',
        status: 'active',
        vars: { catalog_order_version: 1, itens: [] },
      });
      await deliver('confirmation', {
        type: 'interactive',
        context: { id: 'summary-A' },
        interactive: {
          type,
          [type]: { id: 'confirmar_pedido', title: 'Confirmar pedido' },
        },
      });
      expect(mocks.flow).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            kind: 'interactive_reply',
            context_message_id: 'summary-A',
          }),
        })
      );
    }
  );
  it.each([
    { type: 'text', text: { body: 'Delivery' } },
    {
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'delivery', title: 'Delivery' },
      },
    },
  ])(
    'routes the new native cart and its reply once, preserving the completed text draft: $type',
    async (reply) => {
      const cart = {
        type: 'order',
        order: {
          catalog_id: 'catalog',
          product_items: [
            {
              product_retailer_id: 'emp_hamburguer',
              quantity: 2,
              item_price: 14,
              currency: 'BRL',
            },
          ],
        },
      };
      await deliver('new-cart', cart);
      await deliver('new-cart', cart);
      await deliver('new-reply', reply);
      await deliver('new-reply', reply);
      expect(mocks.flow).toHaveBeenCalledTimes(2);
      expect(mocks.flow.mock.calls[0][0].message.kind).toBe('catalog_order');
      expect(mocks.flow.mock.calls[1][0].message).toMatchObject({
        meta_message_id: 'new-reply',
        kind: reply.type === 'interactive' ? 'interactive_reply' : 'text',
      });
      expect(tables.whatsapp_inbound_receipts).toHaveLength(2);
      expect(tables.messages).toHaveLength(2);
      expect(tables.order_drafts[0].state).toEqual(oldDraft);
      expect(tables.flow_runs[0].status).toBe('active');
      expect(mocks.db.rpc).not.toHaveBeenCalledWith(
        'claim_order_turn',
        expect.anything()
      );
      expect(mocks.db.rpc).not.toHaveBeenCalledWith(
        'handle_conversation_handoff',
        expect.anything()
      );
      expect(mocks.payment).not.toHaveBeenCalled();
      expect(mocks.text).not.toHaveBeenCalled();
      expect(mocks.ai).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('lets a plain greeting "ola" pass through to AI responder on open conversations', async () => {
    tables.order_drafts = [];
    mocks.flow.mockResolvedValueOnce({ consumed: false, outcome: 'none' });
    await deliver('greeting-ola', { type: 'text', text: { body: 'ola' } });
    expect(mocks.ai).toHaveBeenCalledTimes(1);
    expect(mocks.payment).not.toHaveBeenCalled();
  });
});
