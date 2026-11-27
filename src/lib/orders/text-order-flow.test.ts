import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  processFreeTextOrderInbound,
  processInboundHandoff,
  type TextOrderFlowContext,
} from './text-order-flow';
import { createOrderWithMercadoPago } from './create-order-with-mercado-pago';
import { catalogEntries, loadOrderCatalog } from './order-catalog';
import { applyContactTag } from './create-order';
import type { OrderDraft } from './order-draft';
import { getExistingPaymentLink } from '@/lib/payments/mercado-pago';
import { saveContactOrderFields } from './custom-fields';

vi.mock('./create-order-with-mercado-pago', () => ({
  createOrderWithMercadoPago: vi.fn(),
}));
vi.mock('./order-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./order-catalog')>()),
  loadOrderCatalog: vi.fn(),
}));
vi.mock('@/lib/payments/mercado-pago', () => ({
  getExistingPaymentLink: vi.fn(),
}));
vi.mock('./custom-fields', () => ({
  getSavedCustomerAddress: vi.fn(async () => null),
  saveContactOrderFields: vi.fn(async () => undefined),
}));
vi.mock('./create-order', () => ({
  applyContactTag: vi.fn(async () => undefined),
  TAG_HUMANO: 'Precisa de Atendente',
}));

function fixture() {
  let state: OrderDraft | null = null;
  let processing: string | null = null;
  const events = new Map<string, { status: string; error_detail?: string }>();
  const outbox = new Set<string>();
  const messages: Record<string, unknown>[] = [];
  let storedOrder: Record<string, unknown> | null = {
    id: 'order-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    preference_id: 'preference-1',
    external_reference: 'TEXT-draft-1-2',
    total: 28,
    payment_url:
      'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test',
    status: 'pending',
  };
  let storedBinding: Record<string, unknown> | null = {
    id: 'order-1',
    account_id: 'account-1',
  };
  let orderReadError = false;
  let conversationDisabled = false;
  let conversationReason: string | null = null;
  let humanAt: string | null = null;
  let resumedAt: string | null = null;
  let conversationStatus = 'open';
  let draftUpdatedAt = '2026-10-11T02:00:00Z';
  let failMessages = false;
  let activeFlow: {
    id: string;
    account_id: string;
    status: string;
    consent_revision: number;
    vars: Record<string, unknown>;
  } | null = null;
  const flowUpdates: Record<string, unknown>[] = [];
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, string>) => {
      if (name === 'handle_conversation_handoff') {
        if (args.p_new_order && !args.p_request) {
          conversationDisabled = false;
          conversationReason = null;
          conversationStatus = 'open';
          resumedAt = new Date().toISOString();
        }
        if (args.p_request) {
          conversationDisabled = true;
          conversationReason = args.p_reason;
        }
        return {
          data: {
            blocked:
              conversationDisabled ||
              conversationStatus === 'pending' ||
              Boolean(
                humanAt &&
                (!resumedAt || Date.parse(humanAt) >= Date.parse(resumedAt))
              ),
            episode_id: 'episode-1',
            notice: 'waiting',
          },
          error: null,
        };
      }
      if (name === 'rotate_order_draft') {
        state = {
          id: 'draft-2',
          version: 0,
          items: [],
          unresolved: [],
          stage: 'collecting',
          total: 0,
        };
        return { data: state, error: null };
      }
      if (name === 'flow_checkout_correct') {
        if (
          !activeFlow ||
          activeFlow.id !== args.p_run_id ||
          activeFlow.account_id !== args.p_account_id
        )
          return { data: [], error: null };
        const corrected = {
          ...activeFlow,
          status: 'handed_off',
          consent_revision: activeFlow.consent_revision + 1,
          vars: {
            ...activeFlow.vars,
            pending_order_change: args.p_text,
            catalog_review_text: args.p_text,
            pedido_confirmado: 'false',
          },
        };
        flowUpdates.push(corrected);
        activeFlow = null;
        return { data: [corrected], error: null };
      }
      if (name !== 'claim_order_turn')
        throw new Error(`Unexpected RPC ${name}`);
      if (events.has(args.p_message_id))
        return { data: { outcome: 'duplicate' }, error: null };
      events.set(args.p_message_id, { status: 'processing' });
      if (processing) {
        events.set(args.p_message_id, { status: 'blocked' });
        return { data: { outcome: 'busy' }, error: null };
      }
      processing = args.p_message_id;
      return {
        data: { outcome: 'claimed', id: 'draft-1', state },
        error: null,
      };
    }),
    from(table: string) {
      let operation = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const result = () => {
        if (table === 'order_inbound_events') {
          if (operation === 'select') {
            const existingEvent = events.get(String(filters.meta_message_id));
            return {
              data: existingEvent ? { status: existingEvent.status } : null,
              error: null,
            };
          }
          if (operation === 'insert') {
            const msgId = String(payload.meta_message_id);
            if (events.has(msgId))
              return { data: null, error: { code: '23505', message: 'duplicate' } };
            events.set(msgId, {
              status: String(payload.status),
              error_detail: payload.error_detail as string | undefined,
            });
            return { data: null, error: null };
          }
          if (operation === 'update') {
            const msgId = String(filters.meta_message_id);
            const cur = events.get(msgId) ?? { status: 'failed' };
            events.set(msgId, {
              ...cur,
              ...(payload.status ? { status: String(payload.status) } : {}),
              ...(payload.error_detail !== undefined
                ? { error_detail: String(payload.error_detail) }
                : {}),
            });
            return { data: null, error: null };
          }
        }
        if (table === 'conversations') {
          if (operation === 'update' && payload.ai_autoreply_disabled === true)
            conversationDisabled = true;
          return {
            data: {
              ai_autoreply_disabled: conversationDisabled,
              bot_pause_reason: conversationReason,
              last_agent_message_at: humanAt,
              bot_order_resumed_at: resumedAt,
              status: conversationStatus,
            },
            error: null,
          };
        }
        if (table === 'orders')
          return {
            data: filters.preference_id ? storedBinding : storedOrder,
            error: orderReadError ? { message: 'order read failed' } : null,
          };
        if (table === 'flow_runs') {
          if (operation === 'select') return { data: activeFlow, error: null };
          flowUpdates.push(payload);
          if (payload.status === 'handed_off') activeFlow = null;
          return { data: null, error: null };
        }
        if (table === 'order_drafts') {
          if (operation === 'select')
            return {
              data: state ? { state, updated_at: draftUpdatedAt } : null,
              error: null,
            };
          if (filters.processing_message_id !== processing)
            return { data: null, error: { message: 'claim mismatch' } };
          state = structuredClone(payload.state) as OrderDraft;
          draftUpdatedAt = String(payload.updated_at);
          if (payload.processing_message_id === null) processing = null;
          return { data: { id: 'draft-1' }, error: null };
        }
        if (table === 'order_message_outbox' && operation === 'insert') {
          const key = String(payload.effect_key);
          if (outbox.has(key))
            return {
              data: null,
              error: { code: '23505', message: 'duplicate' },
            };
          outbox.add(key);
        }
        if (table === 'messages' && operation === 'insert') {
          if (failMessages)
            return {
              data: null,
              error: { message: 'DB unavailable after Meta accepted' },
            };
          messages.push(payload);
        }
        return { data: null, error: null };
      };
      const builder = {
        select() {
          return builder;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return builder;
        },
        insert(value: Record<string, unknown>) {
          operation = 'insert';
          payload = value;
          return builder;
        },
        update(value: Record<string, unknown>) {
          operation = 'update';
          payload = value;
          return builder;
        },
        async maybeSingle() {
          return result();
        },
        async single() {
          return result();
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return builder;
    },
  };
  const context: Omit<
    TextOrderFlowContext,
    'inboundText' | 'inboundMessageId'
  > = {
    supabase: db as unknown as SupabaseClient,
    accountId: 'account-1',
    userId: 'owner-1',
    conversationId: 'conversation-1',
    contactRecord: { id: 'contact-1', name: 'Rafael', phone: '5511999999999' },
    contactName: 'Rafael',
    senderPhone: '5511999999999',
    phoneNumberId: 'phone-1',
    accessToken: 'fake-test-token',
    inboundTimestamp: '2026-10-11T01:00:00.000Z',
  };
  return {
    events,
    messages,
    db,
    flowUpdates,
    setActiveCatalog: () => {
      activeFlow = {
        id: 'catalog-run-2',
        account_id: 'account-1',
        status: 'active',
        consent_revision: 0,
        vars: {
          catalog_order_version: 1,
          itens: [{ id: 'sausage', quantity: 1 }],
        },
      };
    },
    state: () => state!,
    conversationDisabled: () => conversationDisabled,
    pause: () => {
      conversationDisabled = true;
    },
    pending: () => {
      conversationStatus = 'pending';
    },
    native: (items: Parameters<typeof processInboundHandoff>[1]) =>
      processInboundHandoff(
        {
          ...context,
          inboundText: 'Carrinho nativo',
          inboundMessageId: 'native',
        },
        items
      ),
    setPriorHuman: () => {
      humanAt = new Date(Date.now() - 60000).toISOString();
    },
    setHumanActive: () => {
      humanAt = new Date().toISOString();
    },
    seedDraft: (draft: OrderDraft, updatedAt = draftUpdatedAt) => {
      state = structuredClone(draft);
      draftUpdatedAt = updatedAt;
    },
    setFailMessages: () => {
      failMessages = true;
    },
    setOrder: (patch: Record<string, unknown> | null) => {
      storedOrder = patch === null ? null : { ...storedOrder, ...patch };
    },
    setBinding: (binding: Record<string, unknown> | null) => {
      storedBinding = binding;
    },
    failOrderRead: () => {
      orderReadError = true;
    },
    turn: (inboundText: string, inboundMessageId: string) =>
      processFreeTextOrderInbound({
        ...context,
        inboundText,
        inboundMessageId,
      }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-11T02:00:00Z');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid-test' }] }), {
          status: 200,
        })
    )
  );
  vi.mocked(loadOrderCatalog).mockResolvedValue([
    { id: 'meat', nome: 'Carne', preco: 14, aliases: ['carne'] },
    { id: 'sausage', nome: 'Calabresa', preco: 14, aliases: ['calabresa'] },
    {
      id: 'cheese',
      nome: 'Queijo com tomate',
      preco: 14,
      aliases: ['queijo com tomate'],
    },
    { id: 'escarole', nome: 'Escarola', preco: 14, aliases: ['escarola'] },
  ]);
  vi.mocked(createOrderWithMercadoPago).mockResolvedValue({
    ok: true,
    orderId: 'order-1',
    dealId: 'deal-1',
    link_mercado_pago:
      'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test',
  });
  vi.mocked(getExistingPaymentLink).mockReset();
  vi.mocked(getExistingPaymentLink).mockResolvedValue(
    'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'
  );
});

describe('text order pipeline (all external effects mocked)', () => {
  it('persists the whole-order note in every checkout description after explicit confirmation', async () => {
    const f = fixture();
    vi.mocked(loadOrderCatalog).mockResolvedValue([
      { id: 'meat', nome: 'Carne', preco: 14, aliases: ['carne'] },
      { id: 'romeu', nome: 'Romeu e Julieta', preco: 14.5, aliases: ['romeu e julieta'] },
    ]);
    const text = '03 carne\n01 Romeu e Julieta\nBem passadas!!!\nRua Cruzeiro do Sul 352, Vila Leopoldina';
    expect((await f.turn(text, 'whole-note')).outcome).toBe('confirmation_requested');
    expect(f.state().items.map((item) => item.notes)).toEqual(['Bem passadas!!!', 'Bem passadas!!!']);
    expect(String(f.messages.at(-1)?.content_text).match(/Obs\. do pedido:/g)).toHaveLength(1);
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    expect((await f.turn('confirmo o pedido', 'whole-note-confirm')).outcome).toBe('order_created');
    await f.turn('confirmo o pedido', 'whole-note-confirm');
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(createOrderWithMercadoPago).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ items: [
        expect.objectContaining({ id: 'meat', quantity: 3, description: 'Bem passadas!!!' }),
        expect.objectContaining({ id: 'romeu', quantity: 1, description: 'Bem passadas!!!' }),
      ] })
    );
  });
  it('carries a simple observation through address, fresh confirmation and checkout description exactly once', async () => {
    const f = fixture();
    vi.mocked(loadOrderCatalog).mockResolvedValue([
      { id: 'meat', nome: 'Carne', preco: 14, aliases: ['carne'] },
      { id: 'romeu', nome: 'Romeu e Julieta', preco: 14.5, aliases: ['romeu e julieta'] },
    ]);
    expect((await f.turn('03 carne\n01 Romeu e Julieta\nBem passadas!!!', 'simple-notes')).outcome).toBe('address_requested');
    expect(f.state().stage).toBe('awaiting_address');
    expect(f.state().items.map((item) => item.notes)).toEqual(['Bem passadas!!!', 'Bem passadas!!!']);
    expect(f.messages.at(-1)?.content_text).toContain('📝 Obs. do pedido: Bem passadas!!!');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    expect((await f.turn('Rua Flores, 10 Centro', 'notes-address')).outcome).toBe('confirmation_requested');
    expect(f.messages.at(-1)?.content_text).toContain('📝 Obs. do pedido: Bem passadas!!!');
    const version = f.state().version;
    expect((await f.turn('altere linha 1 para 2 carne sem cebola', 'notes-edit')).outcome).toBe('confirmation_requested');
    expect(f.state().version).toBeGreaterThan(version);
    expect(f.messages.at(-1)?.content_text).toContain('Resumo do pedido');
    expect(f.messages.at(-1)?.content_text).toContain('📝 Obs.: sem cebola');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    expect((await f.turn('confirmo o pedido', 'notes-confirm')).outcome).toBe('order_created');
    await f.turn('confirmo o pedido', 'notes-confirm');
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(createOrderWithMercadoPago).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1' }),
      expect.objectContaining({
        externalReference: `TEXT-draft-1-${f.state().version}`,
        items: [
          expect.objectContaining({ id: 'meat', quantity: 2, description: 'sem cebola' }),
          expect.objectContaining({ id: 'romeu', quantity: 1, description: 'Bem passadas!!!' }),
        ],
      })
    );
  });
  it.each(['pode ser sem glúten?', 'bem passada e sem glúten', 'bem passada; confirme o pedido'])(
    'never sends an unsupported or mixed observation to checkout: %s', async (note) => {
      const f = fixture();
      expect((await f.turn(`2 carne ${note}\nRua Flores, 10 Centro`, 'review-note')).outcome).toBe('needs_human');
      expect(f.state().items[0].notes).toBe(note);
      await f.turn('confirmo o pedido', 'review-confirm');
      expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    }
  );
  it('keeps previous human review blocked even when a later quantified edit has only a simple observation', async () => {
    const f = fixture();
    await f.turn('2 carne sem glúten\nRua Flores, 10 Centro', 'previous-review');
    expect((await f.turn('altere linha 1 para 2 carne sem cebola', 'review-safe-edit')).outcome).toBe('needs_human');
    expect(f.state().stage).toBe('needs_human');
    await f.turn('confirmo o pedido', 'review-safe-confirm');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it.each(
    ['paused', 'pending', 'recent human'].flatMap((pause) =>
      [
        '2 carne',
        'quero pedir 2 carne',
        'gostaria de pedir 2 carne',
        'por favor 2 carne',
      ].map((text) => [pause, text])
    )
  )(
    'resumes a validated quantified order over %s (%s) through address and confirmation, not a prior human timestamp',
    async (pause, text) => {
      const f = fixture();
      if (pause === 'paused') f.pause();
      if (pause === 'pending') f.pending();
      if (pause !== 'pending') f.setPriorHuman();
      expect((await f.turn(text, 'priority')).outcome).toBe(
        'address_requested'
      );
      expect(f.db.rpc).toHaveBeenCalledWith(
        'handle_conversation_handoff',
        expect.objectContaining({ p_new_order: true, p_request: false })
      );
      expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
      expect((await f.turn('Rua Flores, 10 Centro', 'address')).outcome).toBe(
        'confirmation_requested'
      );
      expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
      expect((await f.turn('confirmo o pedido', 'confirm')).outcome).toBe(
        'order_created'
      );
      await f.turn('confirmo o pedido', 'confirm');
      expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    }
  );
  it.each([
    'quero carne',
    '1 lagosta',
    'não quero 2 carne',
    'quanto custa 2 carne?',
    'quero 2 carne e 1 lagosta',
    'Rua Flores, 10 Centro',
    'Pix feito',
    'Oi',
    'atendente',
  ])(
    'never grants priority to unvalidated/unquantified text: %s',
    async (text) => {
      const f = fixture();
      f.pause();
      expect((await f.turn(text, 'not-priority')).outcome).toBe('needs_human');
      expect(f.db.rpc).toHaveBeenCalledWith(
        'handle_conversation_handoff',
        expect.objectContaining({ p_new_order: false })
      );
      expect(f.conversationDisabled()).toBe(true);
      expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    }
  );
  it('keeps a genuinely new human send after resumption active', async () => {
    const f = fixture();
    f.pause();
    f.setPriorHuman();
    await f.turn('2 carne', 'priority');
    vi.advanceTimersByTime(1000);
    f.setHumanActive();
    expect((await f.turn('Rua Flores, 10 Centro', 'address')).outcome).toBe(
      'needs_human'
    );
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('retains ordinary waiting notices when the catalog is unavailable, without attempting order priority', async () => {
    const f = fixture();
    f.pause();
    vi.mocked(loadOrderCatalog).mockRejectedValue(
      new Error('catalog unavailable')
    );
    expect((await f.turn('Oi', 'waiting-no-catalog')).outcome).toBe(
      'needs_human'
    );
    expect(f.messages.at(-1)?.content_text).toBe(
      'Um atendente já vai te responder.'
    );
    expect(loadOrderCatalog).not.toHaveBeenCalled();
    expect(f.db.rpc).toHaveBeenCalledWith(
      'handle_conversation_handoff',
      expect.objectContaining({ p_new_order: false, p_request: false })
    );
  });
  it('resumes routing but still escalates an active catalog correction without stealing or charging its cart', async () => {
    const f = fixture();
    f.pause();
    f.setPriorHuman();
    f.setActiveCatalog();
    expect(
      (await f.turn('2 carne', 'priority-catalog-correction')).outcome
    ).toBe('needs_human');
    expect(f.db.rpc).toHaveBeenCalledWith(
      'handle_conversation_handoff',
      expect.objectContaining({ p_new_order: true })
    );
    expect(f.db.rpc).toHaveBeenCalledWith(
      'flow_checkout_correct',
      expect.objectContaining({ p_text: '2 carne' })
    );
    expect(
      f.db.rpc.mock.calls.some(([name]) => name === 'claim_order_turn')
    ).toBe(false);
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('accepts explicit plus additions using the validated live catalog', async () => {
    vi.mocked(loadOrderCatalog).mockResolvedValue(
      catalogEntries([
        {
          id: 'chicken',
          name: 'Empanada de Frango',
          price: 15,
          is_available: true,
        },
        {
          id: 'ricotta',
          name: 'Empanada de Ricota',
          price: 16,
          is_available: true,
        },
      ])
    );
    const f = fixture();
    f.pause();
    expect((await f.turn('+1frango,+1ricota', 'plus')).outcome).toBe(
      'address_requested'
    );
    expect(f.state().items.map((i) => [i.id, i.quantity])).toEqual([
      ['chicken', 1],
      ['ricotta', 1],
    ]);
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('validates native lines before prioritizing and retains notes for downstream review', async () => {
    const f = fixture();
    f.pause();
    const items = [
      { retailer_id: 'carne', name: 'Carne', quantity: 2, unit_price: 0.01 },
    ];
    expect(await f.native({ items, notes: 'sem pimentão' })).toBe(false);
    expect(f.db.rpc).toHaveBeenCalledWith(
      'handle_conversation_handoff',
      expect.objectContaining({ p_new_order: true })
    );
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5])(
    'does not prioritize invalid native quantity %s',
    async (quantity) => {
      const f = fixture();
      f.pause();
      expect(
        await f.native({
          items: [
            { retailer_id: 'carne', name: 'Carne', quantity, unit_price: 14 },
          ],
        })
      ).toBe(true);
      expect(f.db.rpc).toHaveBeenCalledWith(
        'handle_conversation_handoff',
        expect.objectContaining({ p_new_order: false })
      );
    }
  );
  it.each(['Oi', 'Alô', 'Pix feito', 'Falar com atendente'])(
    'acknowledges paused inbound %s once per handoff episode without a payment',
    async (text) => {
      const f = fixture();
      await f.turn('2 carne', 'items');
      f.pause();
      const before = f.messages.length;
      expect((await f.turn(text, 'paused')).outcome).toBe('needs_human');
      expect(f.messages.at(-1)?.content_text).toBe(
        'Um atendente já vai te responder.'
      );
      expect(f.messages).toHaveLength(before + 1);
      await f.turn(text, 'paused-again');
      expect(f.messages).toHaveLength(before + 1);
      expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    }
  );
  it('handles an explicit human request even without a text draft', async () => {
    const f = fixture();
    expect((await f.turn('Falar com atendente', 'human')).outcome).toBe(
      'needs_human'
    );
    expect(f.conversationDisabled()).toBe(true);
    expect(f.messages.at(-1)?.content_text).toBe(
      'Um atendente já vai te responder.'
    );
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('does not turn bot resumption consent into an unresolved order instruction', async () => {
    const f = fixture();
    await f.turn('2 carne', 'items');
    const snapshot = structuredClone(f.state());
    expect((await f.turn('Continuar com o bot', 'resume')).outcome).toBe(
      'bot_resumed'
    );
    expect(f.state()).toEqual(snapshot);
    expect(f.conversationDisabled()).toBe(false);
  });
  it('keeps legacy cart age through greetings so an old uncharged draft can expire', async () => {
    const f = fixture();
    const old = '2026-10-09T02:00:00.000Z';
    f.setOrder(null);
    f.seedDraft(
      {
        id: 'old',
        version: 1,
        stage: 'awaiting_address',
        items: [
          {
            id: 'meat',
            title: 'Carne',
            quantity: 2,
            unitPrice: 14,
            totalPrice: 28,
          },
        ],
        unresolved: [],
        total: 28,
      },
      old
    );
    await f.turn('Oi', 'greeting');
    expect(f.state()).toMatchObject({ cartUpdatedAt: old });
    await f.turn('Quero 3 calabresa', 'fresh');
    expect(f.state().items).toEqual([
      expect.objectContaining({ id: 'sausage', quantity: 3 }),
    ]);
  });
  it('remembers the canonical reference when a matching open payment is reused', async () => {
    const f = fixture();
    vi.mocked(createOrderWithMercadoPago).mockResolvedValueOnce({
      ok: true,
      orderId: 'order-1',
      dealId: 'deal-1',
      externalReference: 'TEXT-earlier-9',
      link_mercado_pago:
        'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test',
    });
    f.setOrder({ external_reference: 'TEXT-earlier-9' });
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    await f.turn('confirmo o pedido', 'confirm');
    expect(f.state().paymentReference).toBe('TEXT-earlier-9');
    expect(
      (await f.turn('reenvie o link de pagamento', 'resend')).outcome
    ).toBe('payment_resent');
    expect(getExistingPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ external_reference: 'TEXT-earlier-9' })
    );
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
  });
  it('starts a new cart after a paid order rather than inheriting payment_created', async () => {
    const f = fixture();
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    await f.turn('confirmo o pedido', 'confirm');
    f.setOrder({ status: 'paid' });
    await f.turn('Quero 3 calabresa', 'new-order');
    expect(f.state().id).toBe('draft-2');
    expect(f.state().items).toEqual([
      expect.objectContaining({ id: 'sausage', quantity: 3 }),
    ]);
    expect(f.state().stage).toBe('awaiting_address');
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
  });
  it('saves only complete addresses to the customer profile and explains where to copy the real Pix code', async () => {
    const f = fixture();
    await f.turn('2 carne', 'items');
    await f.turn('Rua Flores, 10', 'incomplete-address');
    expect(saveContactOrderFields).toHaveBeenLastCalledWith(
      expect.anything(),
      'account-1',
      'contact-1',
      expect.objectContaining({ endereco: undefined })
    );
    await f.turn('Rua Flores, 10 Centro', 'address');
    expect(saveContactOrderFields).toHaveBeenLastCalledWith(
      expect.anything(),
      'account-1',
      'contact-1',
      expect.objectContaining({ endereco: 'Rua Flores, 10 Centro' })
    );
    await f.turn('confirmo o pedido', 'confirm');
    const payment = f.messages.at(-1)!;
    expect(payment.content_text).toContain('Pix Copia e Cola');
    expect(payment.content_text).toContain('checkout');
    expect(payment.content_text).not.toContain('[Botão:');
    expect(payment.interactive_payload).toMatchObject({
      type: 'cta_url',
      action: {
        parameters: {
          url: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test',
        },
      },
    });
  });
  it.each([
    'Vixi está meio confuso',
    'Seria este pedido',
    'não entendi',
    'qual o valor da entrega?',
    'podemos fechar',
  ])(
    'answers "%s" without treating it as an address or abandoning the cart',
    async (comment) => {
      const f = fixture();
      await f.turn('2 carne', 'items');
      const snapshot = structuredClone(f.state());
      expect((await f.turn(comment, 'comment')).outcome).toBe(
        'address_requested'
      );
      expect(f.state()).toEqual(snapshot);
      expect(f.conversationDisabled()).toBe(false);
      expect(f.messages.at(-1)?.content_text).toContain('Rua, Número e Bairro');
      expect(f.messages.at(-1)?.content_text).not.toContain('Resumo do pedido');
      expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
      await f.turn('Rua Flores, 10 Centro', 'address');
      expect(f.state().stage).toBe('awaiting_confirmation');
      expect(f.messages.at(-1)?.content_text).toContain('2x Carne');
    }
  );
  it('accumulates repeated products from the durable cart without summary spam or duplicate retry additions', async () => {
    const f = fixture();
    await f.turn('2 carne', 'first-items');
    await f.turn('2 carne', 'more-items');
    expect(f.state().items).toEqual([
      expect.objectContaining({ id: 'meat', quantity: 4 }),
    ]);
    expect(f.state().total).toBe(56);
    await f.turn('1 calabresa', 'new-flavor');
    expect(f.state().items.map((item) => item.quantity)).toEqual([4, 1]);
    expect(f.state().total).toBe(70);
    await f.turn('2 carne', 'more-items');
    expect(f.state().items.map((item) => item.quantity)).toEqual([4, 1]);
    expect(f.messages).toHaveLength(3);
    expect(
      f.messages.every(
        (message) => !String(message.content_text).includes('Resumo do pedido')
      )
    ).toBe(true);
    await f.turn('Rua Flores, 10 Centro', 'address');
    expect(f.messages.at(-1)?.content_text).toContain('4x Carne');
    expect(f.messages.at(-1)?.content_text).toContain('1x Calabresa');
    expect(f.messages.at(-1)?.content_text).toContain('🚚 Entrega: *GRÁTIS*');
    expect(f.messages.at(-1)?.content_text).toContain('R$ 70,00');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    await f.turn('confirmo o pedido', 'confirmation');
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(createOrderWithMercadoPago).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 'meat', quantity: 4 }),
          expect.objectContaining({ id: 'sausage', quantity: 1 }),
        ],
      })
    );
    expect(
      f.messages.filter((message) =>
        String(message.content_text).includes('Resumo do pedido')
      )
    ).toHaveLength(1);
  });
  it('keeps the exact 5/2/2 order through address, free delivery, confirmation and one real CTA payload', async () => {
    vi.mocked(loadOrderCatalog).mockResolvedValue(
      catalogEntries([
        {
          id: 'ham',
          name: 'Empanada de Presunto e Queijo',
          price: 11,
          is_available: true,
        },
        {
          id: 'tuna',
          name: 'Empanada de Atum com Queijo',
          price: 13,
          is_available: true,
        },
        {
          id: 'caprese',
          name: 'Empanada de Queijo, Tomate, Manjericão e Orégano',
          price: 17.25,
          is_available: true,
        },
      ])
    );
    const f = fixture();
    expect(
      (
        await f.turn(
          '5 presunto e queijo, 2 atum, 2 queijo tomate e manjericão',
          'reported-items'
        )
      ).outcome
    ).toBe('address_requested');
    expect(f.state().items.map((item) => item.quantity)).toEqual([5, 2, 2]);
    expect(f.state().total).toBe(5 * 11 + 2 * 13 + 2 * 17.25);
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    expect((await f.turn('Rua Flores, 10 Centro', 'address')).outcome).toBe(
      'confirmation_requested'
    );
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    await f.turn('confirmo o pedido', 'confirm');
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(createOrderWithMercadoPago).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1' }),
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 'ham', quantity: 5, unitPrice: 11 }),
          expect.objectContaining({ id: 'tuna', quantity: 2, unitPrice: 13 }),
          expect.objectContaining({
            id: 'caprese',
            quantity: 2,
            unitPrice: 17.25,
          }),
        ],
        deliveryAddress: 'Rua Flores, 10 Centro',
      })
    );
    const payload = JSON.parse(
      vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string
    );
    expect(payload.type).toBe('interactive');
    expect(payload.interactive.type).toBe('cta_url');
    expect(payload.interactive.body.text).not.toContain('[Botão:');
    expect(payload.interactive.body.text).not.toContain('https://');
    expect(payload.interactive.action.parameters.url).toBe(
      'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test'
    );
    await f.turn('ok', 'later-ok');
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(
      f.messages.filter((message) => message.content_type === 'interactive')
    ).toHaveLength(1);
  });
  it('preserves the five unrecognized ham items and blocks even confirmation of the partial order', async () => {
    const f = fixture();
    await f.turn('5 presunto e queijo, 2 carne', 'missing-product');
    expect(f.state().unresolved.join(' ')).toContain('5 presunto e queijo');
    expect(f.messages[0].content_text).toContain('5 presunto e queijo');
    await f.turn('confirmo o pedido', 'confirm');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('rejects the reported food text as an address without checkout', async () => {
    const f = fixture();
    await f.turn('2 carne', 'items');
    await f.turn('3 hambúrguer...', 'bad-address');
    expect(f.state().deliveryAddress).toBeUndefined();
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('does not restart or repeat a payment on a later ok', async () => {
    const f = fixture();
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    await f.turn('confirmo o pedido', 'confirm');
    const before = structuredClone(f.state());
    await f.turn('ok', 'later-ok');
    expect(f.state()).toEqual(before);
    expect(f.conversationDisabled()).toBe(false);
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(
      f.messages.filter((message) => message.content_type === 'interactive')
    ).toHaveLength(1);
  });
  it('resends an explicitly requested existing payment without creating another checkout', async () => {
    const f = fixture();
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    await f.turn('confirmo o pedido', 'confirm');
    await f.turn('ok', 'ack');
    await f.turn('reenvie o link de pagamento', 'resend');
    expect(getExistingPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        external_reference: 'TEXT-draft-1-2',
        preference_id: 'preference-1',
        total: 28,
      })
    );
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(
      f.messages.filter((message) => message.content_type === 'interactive')
    ).toHaveLength(2);
    await f.turn('reenvie o link de pagamento', 'resend');
    expect(
      f.messages.filter((message) => message.content_type === 'interactive')
    ).toHaveLength(2);
    expect(getExistingPaymentLink).toHaveBeenCalledTimes(1);
    expect(f.state().stage).toBe('payment_created');
  });
  it.each([
    null,
    { account_id: 'other' },
    { contact_id: 'other' },
    { external_reference: 'other' },
    { preference_id: null },
    { total: 1 },
    { status: 'paid' },
    { status: 'checkout_uncertain' },
  ])(
    'blocks resend for missing or mismatched canonical order %j',
    async (patch) => {
      const f = fixture();
      await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
      await f.turn('confirmo o pedido', 'confirm');
      f.setOrder(patch);
      expect(
        (await f.turn('reenvie o link de pagamento', 'resend')).outcome
      ).toBe('needs_human');
      expect(getExistingPaymentLink).not.toHaveBeenCalled();
      expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
      expect(
        f.messages.filter((message) => message.content_type === 'interactive')
      ).toHaveLength(1);
    }
  );
  it.each([
    null,
    { id: 'other', account_id: 'account-1' },
    { id: 'order-1', account_id: 'other' },
  ])('blocks ambiguous or foreign preference binding %j', async (binding) => {
    const f = fixture();
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    await f.turn('confirmo o pedido', 'confirm');
    f.setBinding(binding);
    await f.turn('reenvie o link de pagamento', 'resend');
    expect(getExistingPaymentLink).not.toHaveBeenCalled();
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(
      f.messages.filter((message) => message.content_type === 'interactive')
    ).toHaveLength(1);
  });
  it.each(['database', 'gateway'])(
    'blocks resend after a %s validation failure without creating a checkout',
    async (failure) => {
      const f = fixture();
      await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
      await f.turn('confirmo o pedido', 'confirm');
      if (failure === 'database') f.failOrderRead();
      else
        vi.mocked(getExistingPaymentLink).mockRejectedValueOnce(
          new Error('gateway unavailable')
        );
      expect(
        (await f.turn('reenvie o link de pagamento', 'resend')).outcome
      ).toBe('needs_human');
      expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
      expect(
        f.messages.filter((message) => message.content_type === 'interactive')
      ).toHaveLength(1);
    }
  );
  it.each([
    'não reenvie o pagamento',
    'já paguei, obrigado',
    'quero alterar o pedido',
  ])('does not interpret %s as a resend request', async (text) => {
    const f = fixture();
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    await f.turn('confirmo o pedido', 'confirm');
    await f.turn(text, 'after-payment');
    expect(getExistingPaymentLink).not.toHaveBeenCalled();
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    expect(
      f.messages.filter((message) => message.content_type === 'interactive')
    ).toHaveLength(1);
  });
  it('invalidates active catalog correction through the locked consent RPC, not a direct vars overwrite', async () => {
    const f = fixture();
    f.setActiveCatalog();
    const result = await f.turn('troca para 3 carne', 'catalog-correction');
    expect(result).toMatchObject({ handled: true, outcome: 'needs_human' });
    expect(f.db.rpc).toHaveBeenCalledWith('flow_checkout_correct', {
      p_account_id: 'account-1',
      p_run_id: 'catalog-run-2',
      p_text: 'troca para 3 carne',
    });
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    expect(
      f.db.rpc.mock.calls.some(([name]) => name === 'claim_order_turn')
    ).toBe(false);
  });
  it.each(['Delivery', 'Rua Nova, 20 Centro', 'confirmo o pedido'])(
    'lets the new active catalog own a reply after a completed text checkout: %s',
    async (reply) => {
      const f = fixture();
      await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'text-items');
      await f.turn('confirmo o pedido', 'text-confirm');
      expect(f.state().stage).toBe('payment_created');
      f.setActiveCatalog();
      const before = structuredClone(f.state());
      expect(await f.turn(reply, 'catalog-reply')).toEqual({ handled: false });
      expect(f.state()).toEqual(before);
      expect(f.flowUpdates).toEqual([]);
      expect(f.db.rpc).toHaveBeenCalledTimes(2);
      expect(f.messages).toHaveLength(2);
      expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
    }
  );
  it('preserves Rafael customization lines in persisted state and summary and hands off without payment', async () => {
    const f = fixture();
    const result = await f.turn(
      '1 queijo com tomate\n2 carne sem pimentão\n2 calabresa sem queijo ou cream cheese\n1 escarola\n5 carne',
      'rafael'
    );
    expect(result.outcome).toBe('needs_human');
    expect(f.state().items.map((item) => item.quantity)).toEqual([
      1, 2, 2, 1, 5,
    ]);
    expect(f.state().items[1].notes).toBe('sem pimentão');
    expect(f.state().items[2].notes).toBe('sem queijo ou cream cheese');
    expect(f.messages[0].content_text).toContain(
      '2x Calabresa — sem queijo ou cream cheese'
    );
    expect(f.messages[0].content_text).toContain('5x Carne');
    expect(applyContactTag).toHaveBeenCalled();
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    await f.turn('confirmo o pedido', 'rafael-confirm');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('requires summary confirmation even with an address and persists the real CTA type/payload', async () => {
    const f = fixture();
    expect(
      (await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items'))
        .outcome
    ).toBe('confirmation_requested');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    expect((await f.turn('confirmo o pedido', 'confirm')).outcome).toBe(
      'order_created'
    );
    expect(createOrderWithMercadoPago).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1' }),
      expect.objectContaining({
        externalReference: 'TEXT-draft-1-2',
        items: [
          expect.objectContaining({ id: 'meat', quantity: 2, unitPrice: 14 }),
        ],
      })
    );
    const payment = f.messages[1];
    expect(payment.content_type).toBe('interactive');
    expect(payment.interactive_payload).toMatchObject({ type: 'cta_url' });
    expect(payment.content_text).toContain('La Empanadas');
    expect(payment.content_text).toContain('R$ 28,00');
    expect(payment.content_text).not.toContain('https://');
    expect(payment.content_text).not.toContain('[Botão:');
  });
  it('applies subsequent corrections and preserves unrelated products across address turns', async () => {
    const f = fixture();
    await f.turn('2 carne, 1 calabresa', 'first');
    await f.turn('na verdade 3 carne', 'correction');
    expect(f.state().items.map((item) => item.quantity)).toEqual([3, 1]);
    await f.turn('Rua Flores, 10 Centro', 'address');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
    await f.turn('confirmo o pedido', 'confirm');
    expect(createOrderWithMercadoPago).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [
          expect.objectContaining({ quantity: 3 }),
          expect.objectContaining({ quantity: 1 }),
        ],
      })
    );
  });
  it('never omits an unknown line or invents a price', async () => {
    const f = fixture();
    expect((await f.turn('2 carne, 1 lagosta', 'unknown')).outcome).toBe(
      'needs_human'
    );
    expect(f.state().unresolved).toEqual(['1 lagosta']);
    expect(f.messages[0].content_text).toContain('1 lagosta');
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
  it('deduplicates inbound retries, messages and checkout calls', async () => {
    const f = fixture();
    await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items');
    expect(
      (await f.turn('2 carne, entregar na Rua Flores, 10 Centro', 'items'))
        .outcome
    ).toBe('duplicate');
    await f.turn('confirmo o pedido', 'confirm');
    expect((await f.turn('confirmo o pedido', 'confirm')).outcome).toBe(
      'duplicate'
    );
    expect(f.messages).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(createOrderWithMercadoPago).toHaveBeenCalledTimes(1);
  });
  it('does not resend a Meta-accepted message when history persistence fails', async () => {
    const f = fixture();
    f.setFailMessages();
    expect((await f.turn('2 carne', 'items')).outcome).toBe('needs_human');
    await f.turn('2 carne', 'items');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.events.get('items')).toMatchObject({
      status: 'failed',
      error_detail: expect.stringContaining('DB unavailable after Meta accepted'),
    });
  });
  it('fails closed on catalog errors, informs the customer clearly and persists error_detail', async () => {
    const f = fixture();
    expect((await f.turn('boa tarde', 'greeting')).handled).toBe(false);
    // Empty draft row left over by an earlier crash must not swallow "ola"
    f.seedDraft({
      id: 'empty-draft',
      version: 0,
      items: [],
      unresolved: [],
      stage: 'collecting',
      total: 0,
    });
    expect((await f.turn('ola', 'greeting-after-empty-draft')).handled).toBe(
      false
    );

    vi.mocked(loadOrderCatalog).mockRejectedValueOnce(
      new Error('catalog unavailable')
    );
    const result = await f.turn('1 carne', 'items');
    expect(result.outcome).toBe('needs_human');
    expect(result.error).toContain('catalog unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.messages.at(-1)?.content_text).toBe(
      'Tivemos uma instabilidade técnica no atendimento automático.\nUm atendente já vai te responder.'
    );
    expect(f.events.get('items')).toMatchObject({
      status: 'failed',
      error_detail: expect.stringContaining('catalog unavailable'),
    });
    expect(createOrderWithMercadoPago).not.toHaveBeenCalled();
  });
});
