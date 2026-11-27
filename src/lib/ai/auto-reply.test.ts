import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiConfig } from './types';

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendPayment: vi.fn(),
  resolveAiPayment: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    handoffDecision: {
      blocked: true,
      episode_id: 'episode',
      notice: 'waiting',
    } as Record<string, unknown>,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}));

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }));
vi.mock('./context', () => ({
  buildConversationContext: h.buildConversationContext,
}));
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }));
vi.mock('./generate', () => ({ generateReply: h.generateReply }));
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendPayment: h.engineSendPayment,
}));
vi.mock('./auto-payment', async (original) => ({
  ...(await original<typeof import('./auto-payment')>()),
  resolveAiPayment: h.resolveAiPayment,
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'order_message_outbox') {
        const q = {
          eq: () => q,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return { insert: async () => ({ error: null }), update: () => q };
      }
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        };
        return chain;
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload;
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args });
      if (name === 'handle_conversation_handoff')
        return Promise.resolve({
          data: h.state.handoffDecision,
          error: null,
        });
      return Promise.resolve({ data: h.state.claim, error: null });
    },
  }),
}));

import { dispatchInboundToAiReply } from './auto-reply';

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
};

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    embeddingsApiKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  };
  h.state.autoResponders = [];
  h.state.claim = true;
  h.state.handoffDecision = {
    blocked: true,
    episode_id: 'episode',
    notice: 'waiting',
  };
  h.state.updatePayload = null;
  h.state.rpcCalls = [];
  h.loadAiConfig.mockResolvedValue(aiConfig());
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'hi' },
  ]);
  h.retrieveKnowledge.mockResolvedValue([]);
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false });
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' });
});

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('respects a persisted bot order resume newer than the historical human send', async () => {
    h.state.conv = {
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      status: 'open',
      last_agent_message_at: new Date(Date.now() - 60_000).toISOString(),
      bot_order_resumed_at: new Date(Date.now() - 30_000).toISOString(),
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).toHaveBeenCalledOnce();
  });
  it('does not bypass a paused conversation without an agent timestamp', async () => {
    h.state.conv = { ai_autoreply_disabled: true, ai_reply_count: 0 };
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });
  it('respects a recent human send even without assignment', async () => {
    h.state.conv = {
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      last_agent_message_at: new Date().toISOString(),
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ]);
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' })
    );
  });

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.']);
    await dispatchInboundToAiReply(ARGS);
    expect(h.retrieveKnowledge).toHaveBeenCalled();
    const systemPrompt = h.generateReply.mock.calls[0][0]
      .systemPrompt as string;
    expect(systemPrompt).toContain('Returns accepted within 30 days.');
  });

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }];
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false;
    await dispatchInboundToAiReply(ARGS);
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }));
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      last_agent_message_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      last_agent_message_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([]);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it.each(['human_active', 'technical_error'] as const)(
    'auto-resumes %s pause after 30 minutes and sends welcome + menu for "ola"',
    async (reason) => {
      const expired = new Date(Date.now() - 60_000).toISOString();
      h.state.handoffDecision = { blocked: false, resumed: true };
      h.state.conv = {
        status: 'pending',
        ai_autoreply_disabled: true,
        ai_reply_count: 0,
        bot_pause_reason: reason,
        bot_resume_after: expired,
        last_agent_message_at:
          reason === 'human_active'
            ? new Date(Date.now() - 31 * 60_000).toISOString()
            : null,
      };
      h.buildConversationContext.mockResolvedValue([
        { role: 'user', content: 'ola' },
      ]);

      await dispatchInboundToAiReply(ARGS);

      expect(h.state.rpcCalls[0]).toEqual({
        name: 'handle_conversation_handoff',
        args: expect.objectContaining({
          p_request: false,
          p_reason: reason,
          p_resume: false,
          p_new_order: false,
        }),
      });
      expect(h.engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('La Empanadas Argentinas'),
        })
      );
      expect(h.generateReply).not.toHaveBeenCalled();
    }
  );

  it('keeps manual and open-checkout payment_review permanently blocked even after 30 minutes', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    h.state.conv = {
      status: 'pending',
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      bot_pause_reason: 'manual',
      bot_resume_after: expired,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.rpcCalls).toHaveLength(0);
    expect(h.engineSendText).not.toHaveBeenCalled();

    h.state.handoffDecision = {
      blocked: true,
      episode_id: 'episode',
      notice: 'waiting',
    };
    h.state.conv = {
      status: 'pending',
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      bot_pause_reason: 'payment_review',
      bot_resume_after: expired,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });
});

describe('dispatchInboundToAiReply — safe AI payment', () => {
  it('keeps configured Haiku and sends the canonical payment with the real engine helper', async () => {
    const config = aiConfig({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
    h.loadAiConfig.mockResolvedValue(config);
    h.generateReply.mockResolvedValue({
      text: 'Pague agora. [TOTAL:140.00]',
      handoff: false,
    });
    h.resolveAiPayment.mockResolvedValue({
      kind: 'payment',
      url: 'https://www.mercadopago.com.br/same',
      reference: 'ORIGINAL',
      cents: 14000,
    });
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({ config })
    );
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain(
      '[TOTAL:xxx.xx]'
    );
    expect(h.resolveAiPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: ARGS.accountId,
        contactId: ARGS.contactId,
        conversationId: ARGS.conversationId,
      }),
      14000
    );
    expect(h.engineSendPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        buttonUrl: 'https://www.mercadopago.com.br/same',
        effectKey: 'ai-payment:conv-1:ORIGINAL',
        bodyText: expect.not.stringContaining('[TOTAL'),
      })
    );
    expect(h.engineSendText).not.toHaveBeenCalled();
    expect(h.state.updatePayload).toBeNull();
  });
  it.each([
    '[TOTAL:-1.00]',
    '[TOTAL:NaN]',
    '[TOTAL:0.00]',
    '[TOTAL:140.00][TOTAL:141.00]',
    '[ TOTAL:140.00 ]',
    '[TOTAL:\n140.00]',
    '[TOTAL:140.00]\n[TOTAL:\n999.00]',
    '[TOTAL:140.00]\r\n[TOTAL:\r\n999.00]',
    '[TOTAL:140.00]\n[TOTAL:\n999.00',
    '[TOTAL:\n[TOTAL:140.00]]',
  ])(
    'asks a clarification without handoff or gateway for %s',
    async (marker) => {
      h.generateReply.mockResolvedValue({
        text: `Pronto ${marker}`,
        handoff: false,
      });
      await dispatchInboundToAiReply(ARGS);
      expect(h.engineSendText).toHaveBeenCalledOnce();
      expect(h.engineSendText.mock.calls[0][0].text).not.toContain('[TOTAL');
      expect(h.engineSendText.mock.calls[0][0].text).toContain(
        'Nenhuma nova cobrança foi criada.'
      );
      expect(h.resolveAiPayment).not.toHaveBeenCalled();
      expect(h.engineSendPayment).not.toHaveBeenCalled();
      expect(h.state.rpcCalls.map((call) => call.name)).toEqual([
        'claim_ai_reply_slot',
      ]);
      expect(h.state.updatePayload).toBeNull();
    }
  );
  it('clarifies missing cart/address/confirmation or mismatch without disabling the bot', async () => {
    h.generateReply.mockResolvedValue({
      text: '[TOTAL:140.00]',
      handoff: false,
    });
    h.resolveAiPayment.mockResolvedValue({
      kind: 'clarify',
      text: 'Envie o endereço completo.',
    });
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Envie o endereço completo.' })
    );
    expect(h.engineSendPayment).not.toHaveBeenCalled();
    expect(h.state.updatePayload).toBeNull();
    expect(h.state.rpcCalls.map((call) => call.name)).toEqual([
      'claim_ai_reply_slot',
    ]);
  });
  it('does not silently handoff mixed payment controls and a handoff sentinel', async () => {
    h.generateReply.mockResolvedValue({
      text: '[TOTAL:140.00]',
      handoff: true,
    });
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).toHaveBeenCalledOnce();
    expect(h.resolveAiPayment).not.toHaveBeenCalled();
    expect(h.state.rpcCalls.map((call) => call.name)).toEqual([
      'claim_ai_reply_slot',
    ]);
  });
  it('never queries the gateway or sends a CTA if the atomic reply slot is lost', async () => {
    h.state.claim = false;
    h.generateReply.mockResolvedValue({
      text: '[TOTAL:140.00]',
      handoff: false,
    });
    await dispatchInboundToAiReply(ARGS);
    expect(h.resolveAiPayment).not.toHaveBeenCalled();
    expect(h.engineSendPayment).not.toHaveBeenCalled();
  });
  it('uses the identical canonical effect for repeated model replies and never falls back after ambiguous delivery', async () => {
    h.generateReply.mockResolvedValue({
      text: '[TOTAL:140.00]',
      handoff: false,
    });
    h.resolveAiPayment.mockResolvedValue({
      kind: 'payment',
      url: 'https://www.mercadopago.com.br/same',
      reference: 'ORIGINAL',
      cents: 14000,
    });
    h.engineSendPayment
      .mockResolvedValueOnce({ whatsapp_message_id: 'm1' })
      .mockRejectedValueOnce(new Error('uncertain'));
    await dispatchInboundToAiReply(ARGS);
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendPayment.mock.calls[0][0]).toEqual(
      h.engineSendPayment.mock.calls[1][0]
    );
    expect(h.engineSendText).not.toHaveBeenCalled();
    expect(h.state.updatePayload).toBeNull();
  });
});

describe('dispatchInboundToAiReply — handoff', () => {
  it('persists the handoff, notifies the team and acknowledges the customer', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Um atendente já vai te responder.' })
    );
    expect(h.state.rpcCalls).toEqual([
      expect.objectContaining({ name: 'handle_conversation_handoff' }),
    ]);
  });
});
