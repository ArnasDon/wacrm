import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  generateReplyWithTools: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    // Bloco 3-A — whether the atomic "claim the welcome send" UPDATE
    // (WHERE commercial_welcome_sent_at IS NULL) wins the race. false
    // simulates "already sent" / "lost the race".
    welcomeClaimed: true as boolean,
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({
  generateReply: h.generateReply,
  generateReplyWithTools: h.generateReplyWithTools,
}))
vi.mock('./tools/commercial-schema', () => ({ COMMERCIAL_TOOLS: [] }))
vi.mock('./tools/handlers/commercial', () => ({
  createCommercialToolExecutor: vi.fn(() => vi.fn()),
}))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
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
          h.state.updatePayload = payload
          // Two call shapes land here:
          //   1) `.update(x).eq('id', id)` — awaited directly (the
          //      handoff-pause update). `eqChain` is thenable.
          //   2) `.update(x).eq('id', id).is(col, null).select('id')` —
          //      the Bloco 3-A atomic welcome-claim (commercial.ts).
          const eqChain: Record<string, unknown> = {
            eq: () => eqChain,
            is: () => ({
              select: () =>
                Promise.resolve({
                  data: h.state.welcomeClaimed ? [{ id: 'conv-1' }] : [],
                  error: null,
                }),
            }),
            then: (resolve: (v: unknown) => unknown) =>
              resolve({ error: null }),
          }
          return eqChain
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.welcomeClaimed = true
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.generateReplyWithTools.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    usage: null,
    iterations: 1,
    hitIterationLimit: false,
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

// ============================================================
// Bloco 3-A — commercial mode (Meta Click-to-WhatsApp ad leads).
// ============================================================
function commercialConv(overrides: Record<string, unknown> = {}) {
  return {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    source: 'meta_ad',
    commercial_welcome_sent_at: null,
    ...overrides,
  }
}

function commercialConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return aiConfig({
    commercialModeEnabled: true,
    commercialSystemPrompt: 'Somos a Acme Growth.',
    commercialBookingUrl: 'https://cal.com/acme/intro',
    commercialWelcomeMessage: null,
    ...overrides,
  })
}

describe('dispatchInboundToAiReply — Bloco 3-A commercial mode', () => {
  it('is a no-op change for a conversation NOT from a meta_ad referral, even with commercial mode on', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    await dispatchInboundToAiReply(ARGS)
    // No welcome update captured — only the normal auto-reply path ran.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('sends the immediate welcome message before generating the AI reply, then still sends the AI reply', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    await dispatchInboundToAiReply(ARGS)

    // Two sends: the instant welcome, then the substantive AI reply.
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId: 'conv-1',
        aiGenerated: false,
        text: expect.stringContaining('anúncio'),
      }),
    )
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: 'Hello!', aiGenerated: true }),
    )
  })

  it('uses the configured commercial_welcome_message instead of the default when set', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ commercialWelcomeMessage: 'Olá! Mensagem à medida.' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: 'Olá! Mensagem à medida.' }),
    )
  })

  it('does not resend the welcome once commercial_welcome_sent_at is already set', async () => {
    h.state.conv = commercialConv({
      commercial_welcome_sent_at: '2026-09-01T00:00:00.000Z',
    })
    h.state.welcomeClaimed = false // the atomic claim loses — already sent
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    await dispatchInboundToAiReply(ARGS)

    // Only the substantive AI reply goes out — no second welcome.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('builds the commercial system prompt from commercialSystemPrompt, not the normal systemPrompt', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ systemPrompt: 'NEVER USE ME', commercialSystemPrompt: 'Somos a Acme Growth.' }),
    )
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReplyWithTools.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Somos a Acme Growth.')
    expect(systemPrompt).not.toContain('NEVER USE ME')
    // No calendar configured on this fixture (commercialCalendarId
    // unset) → falls back to the link, per commercialBookingUrl.
    expect(systemPrompt).toContain('https://cal.com/acme/intro')
  })

  it('sends the fixed fallback (and still counts as "replied") when the AI call throws in commercial mode', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    h.generateReplyWithTools.mockRejectedValue(new Error('provider timed out'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await dispatchInboundToAiReply(ARGS)

    // Welcome + fallback — both sends land, nothing throws out of
    // dispatchInboundToAiReply (it must never throw).
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiGenerated: false,
        text: expect.stringContaining('Recebemos a tua mensagem'),
      }),
    )
    // The reply-cap RPC is never reached on the failure path.
    expect(h.state.rpcCalls).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it('sends the fixed fallback when the model returns no usable text (and no handoff) in commercial mode', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    h.generateReplyWithTools.mockResolvedValue({
      text: '',
      handoff: false,
      usage: null,
      iterations: 1,
      hitIterationLimit: false,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: expect.stringContaining('Recebemos a tua mensagem') }),
    )
    warnSpy.mockRestore()
  })

  it('does NOT send the extra fallback on a genuine handoff signal — welcome already opened the window', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    h.generateReplyWithTools.mockResolvedValue({
      text: '',
      handoff: true,
      usage: null,
      iterations: 1,
      hitIterationLimit: false,
    })

    await dispatchInboundToAiReply(ARGS)

    // Only the welcome went out; the pause/handoff path runs as normal
    // and does not additionally send a fallback message.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('routes commercial mode through generateReplyWithTools with the commercial tool set, never plain generateReply', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReplyWithTools).toHaveBeenCalledTimes(1)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.generateReplyWithTools.mock.calls[0][0]).toMatchObject({
      tools: [], // mocked COMMERCIAL_TOOLS
    })
    expect(typeof h.generateReplyWithTools.mock.calls[0][0].executor).toBe('function')
  })

  it('tells the model to book directly via tools when a commercial calendar is configured', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ commercialCalendarId: 'leads@group.calendar.google.com' }),
    )
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReplyWithTools.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('check_commercial_availability')
    expect(systemPrompt).toContain('book_commercial_meeting')
  })

  it('a non-exception generateReply failure does not affect a NON-commercial conversation (existing behaviour, rethrown to outer catch)', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.loadAiConfig.mockResolvedValue(aiConfig()) // commercial mode off
    h.generateReply.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Must not throw out of dispatchInboundToAiReply — the outer
    // try/catch swallows it, same as before this feature existed.
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
