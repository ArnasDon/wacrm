import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  generateReplyWithTools: vi.fn(),
  engineSendText: vi.fn(),
  notifyHandoff: vi.fn().mockResolvedValue({
    mattermost: { sent: true, via: 'webhook' },
    whatsapp: [{ sent: true, via: 'text' }],
  }),
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
    // The contact's phone number, looked up by dispatchInboundToAiReply
    // to decide team-list membership (isCommercialConversation).
    contactPhone: '351911111111' as string | null,
    // Bloco 3-A / migração 050 — nome e email do contacto, lidos pela
    // trava de handoff (checkHandoffReadiness) junto com
    // conversations.escalation_reason.
    contactName: 'Ricardo Contacto' as string | null,
    contactEmail: 'contacto@example.com' as string | null,
    // Bloco 3-A / 21-09-2026 — nome concreto da empresa do lead, lido
    // pela mesma trava de handoff junto com nome/email/motivo.
    contactCompany: 'Acme Growth Lda' as string | null,
    // Bloco 3-A (migração 054) — contagem que
    // rate_limit_increment_and_check devolve para cada bucket. 1 por
    // omissão (bem abaixo de qualquer limite por omissão), para não
    // afectar os testes que não são sobre rate limiting.
    perNumberRateLimitCount: 1 as number,
    newNumberRateLimitCount: 1 as number,
    // Simula a verificação de rate limit a falhar (erro de BD) — deve
    // deixar passar.
    rateLimitError: false as boolean,
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
vi.mock('@/lib/notifications/notify-team', () => ({ notifyHandoff: h.notifyHandoff }))
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
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    phone: h.state.contactPhone,
                    name: h.state.contactName,
                    email: h.state.contactEmail,
                    company: h.state.contactCompany,
                  },
                  error: null,
                }),
            }),
          }),
        }
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
      if (name === 'rate_limit_increment_and_check') {
        if (h.state.rateLimitError) {
          return Promise.resolve({ data: null, error: { message: 'boom' } })
        }
        const isNewNumberBucket =
          typeof (args as { p_bucket_key?: string })?.p_bucket_key === 'string' &&
          (args as { p_bucket_key: string }).p_bucket_key.startsWith('newnum:')
        const count = isNewNumberBucket
          ? h.state.newNumberRateLimitCount
          : h.state.perNumberRateLimitCount
        return Promise.resolve({ data: count, error: null })
      }
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
  isNewContact: false,
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
  // Este ficheiro cresceu para dezenas de testes que chamam
  // dispatchInboundToAiReply com a mesma accountId ('acct-1') — sem
  // isto, o limitador de taxa real (checkRateLimit, não mockado) ia
  // acumulando chamadas entre testes e acabava por bloquear os
  // últimos testes do ficheiro, sem relação nenhuma com o que estão a
  // validar.
  __resetRateLimitForTests()
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
  h.state.contactPhone = '351911111111'
  h.state.contactName = 'Ricardo Contacto'
  h.state.contactEmail = 'contacto@example.com'
  h.state.contactCompany = 'Acme Growth Lda'
  h.state.perNumberRateLimitCount = 1
  h.state.newNumberRateLimitCount = 1
  h.state.rateLimitError = false
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
    // Bloco 3-A (migração 054) — a verificação de rate limit por
    // número corre antes da reivindicação do slot de resposta. A
    // verificação de números novos não chama a RPC aqui porque ARGS
    // usa isNewContact: false (contacto já existente).
    expect(h.state.rpcCalls.map((c) => c.name)).toEqual([
      'rate_limit_increment_and_check',
      'claim_ai_reply_slot',
    ])
    expect(h.state.rpcCalls[1]).toEqual({
      name: 'claim_ai_reply_slot',
      args: { conversation_id: 'conv-1', max_replies: 3 },
    })
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
    // The per-number rate-limit check runs first, then it still
    // attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(2)
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

// Bloco 3-A (migração 054) — limite de mensagens antes de a IA
// responder. A mensagem em si já foi guardada pelo webhook ANTES de
// dispatchInboundToAiReply ser chamado (ver route.ts) — estes testes
// cobrem só a parte "a IA não responde", não o guardar da mensagem.
describe('dispatchInboundToAiReply — rate limit por número', () => {
  it('mensagem 10 no minuto (contagem = limite) dispara a IA normalmente', async () => {
    h.state.perNumberRateLimitCount = 10 // config default é 10/min
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('mensagem 11 no minuto (contagem > limite) não dispara a IA', async () => {
    h.state.perNumberRateLimitCount = 11
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.generateReplyWithTools).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('janela seguinte (contagem volta a 1) dispara a IA de novo', async () => {
    h.state.perNumberRateLimitCount = 1
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
  })

  it('número da equipa (team_phone_numbers) nunca é limitado, mesmo acima do limite', async () => {
    h.state.perNumberRateLimitCount = 999
    h.loadAiConfig.mockResolvedValue(aiConfig({ teamPhoneNumbers: ['351911111111'] }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    // Isento → nem chega a chamar a RPC de rate limit por número.
    const perNumberCalls = h.state.rpcCalls.filter(
      (c) => c.name === 'rate_limit_increment_and_check',
    )
    expect(perNumberCalls).toHaveLength(0)
  })

  it('número de notificação (notify_phone_numbers) também é isento', async () => {
    h.state.perNumberRateLimitCount = 999
    h.loadAiConfig.mockResolvedValue(aiConfig({ notifyPhoneNumbers: ['351911111111'] }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
  })

  it('erro de base de dados a verificar o limite por número deixa passar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.state.rateLimitError = true
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('dispatchInboundToAiReply — rate limit de números novos por hora', () => {
  it('número novo dentro do limite dispara a IA normalmente', async () => {
    h.state.newNumberRateLimitCount = 60 // config default é 60/hora
    await dispatchInboundToAiReply({ ...ARGS, isNewContact: true })
    expect(h.generateReply).toHaveBeenCalled()
  })

  it('61.º número novo na hora não dispara a IA', async () => {
    h.state.newNumberRateLimitCount = 61
    await dispatchInboundToAiReply({ ...ARGS, isNewContact: true })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('um contacto que já existia (isNewContact=false) nunca é travado por este limite', async () => {
    h.state.newNumberRateLimitCount = 999
    await dispatchInboundToAiReply({ ...ARGS, isNewContact: false })
    expect(h.generateReply).toHaveBeenCalled()
    const newNumberCalls = h.state.rpcCalls.filter(
      (c) =>
        c.name === 'rate_limit_increment_and_check' &&
        (c.args as { p_bucket_key: string }).p_bucket_key.startsWith('newnum:'),
    )
    expect(newNumberCalls).toHaveLength(0)
  })

  it('erro de base de dados a verificar o limite de números novos deixa passar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.state.rateLimitError = true
    await dispatchInboundToAiReply({ ...ARGS, isNewContact: true })
    expect(h.generateReply).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('sends the handoff notice to the customer, disables auto-reply, and writes a summary — never leaves the customer without a word', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    // The notice goes out (never the substantive AI reply, since there
    // wasn't one) — a handoff must never be silent.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        aiGenerated: false,
        text: 'Vou pedir a alguém da equipa que lhe responda. Fique atento, respondemos por aqui.',
      }),
    )
    // The reply-cap RPC is never reached on the handoff path (only the
    // two rate-limit checks run before it).
    expect(h.state.rpcCalls.some((c) => c.name === 'claim_ai_reply_slot')).toBe(false)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('uses the configured handoff_message instead of the default when set', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffMessage: 'Mensagem à medida do handoff.' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Mensagem à medida do handoff.' }),
    )
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
// Bloco 3-A — commercial mode.
//
// A partir desta migração, o modo comercial é o comportamento POR
// OMISSÃO para qualquer conversa (venha de um anúncio ou de uma
// mensagem directa) desde que a conta o tenha ligado. A única excepção
// é um número na lista da equipa (`teamPhoneNumbers`), que continua a
// apanhar o assistente interno.
// ============================================================
function commercialConv(overrides: Record<string, unknown> = {}) {
  return {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    source: 'meta_ad',
    commercial_welcome_sent_at: null,
    // Bloco 3-A / migração 050 — por omissão os dados de handoff já
    // estão completos, para os testes de modo comercial existentes
    // (que não são sobre a trava de handoff) continuarem a exercer o
    // comportamento normal de sempre. Os testes da trava propriamente
    // dita sobrepõem estes campos explicitamente.
    escalation_reason: 'Quer saber mais sobre os serviços da Eter.',
    handoff_blocked_attempts: 0,
    // Correcção 3 (21/09/2026) — por omissão a equipa ainda não foi
    // chamada nesta conversa; overrides explícitos testam o caso
    // "já chamada".
    team_requested_at: null,
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

describe('dispatchInboundToAiReply — Bloco 3-A modo comercial por omissão', () => {
  it('uma conversa vinda de mensagem directa (source "direct") também apanha o modo comercial quando a conta o tem ligado', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.loadAiConfig.mockResolvedValue(commercialConfig())
    await dispatchInboundToAiReply(ARGS)
    // Duas mensagens: a boas-vindas comercial + a resposta substantiva,
    // exactamente como uma conversa vinda do anúncio.
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.generateReplyWithTools).toHaveBeenCalledTimes(1)
  })

  it('um número da lista da equipa apanha o assistente interno, mesmo com o modo comercial ligado', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.state.contactPhone = '+351 912 345 678'
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ teamPhoneNumbers: ['351912345678'] }),
    )
    await dispatchInboundToAiReply(ARGS)
    // Nenhuma boas-vindas comercial — só a resposta normal via
    // generateReply (persona interna), sem ferramentas comerciais.
    expect(h.generateReplyWithTools).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('um número FORA da lista da equipa apanha o modo comercial', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.state.contactPhone = '351900000004'
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ teamPhoneNumbers: ['351912345678'] }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReplyWithTools).toHaveBeenCalledTimes(1)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('lista da equipa vazia manda toda a gente para o modo comercial', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.state.contactPhone = '351900000004'
    h.loadAiConfig.mockResolvedValue(commercialConfig({ teamPhoneNumbers: [] }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReplyWithTools).toHaveBeenCalledTimes(1)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('a comparação de números da equipa ignora espaços, "+" e zeros à frente (normalizePhone)', async () => {
    h.state.conv = commercialConv({ source: 'direct' })
    h.state.contactPhone = '00351 91 234 5678'
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ teamPhoneNumbers: ['+351 912 345 678'] }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReplyWithTools).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })

  it('desligar commercial_mode_enabled repõe o comportamento normal para toda a gente, mesmo vindo do anúncio', async () => {
    h.state.conv = commercialConv({ source: 'meta_ad' })
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ commercialModeEnabled: false }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReplyWithTools).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalledTimes(1)
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
        text: expect.stringContaining('Obrigado por nos contactar'),
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
        text: expect.stringContaining('Recebemos a sua mensagem'),
      }),
    )
    // The reply-cap RPC is never reached on the failure path (only the
    // two rate-limit checks run before it).
    expect(h.state.rpcCalls.some((c) => c.name === 'claim_ai_reply_slot')).toBe(false)
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
      expect.objectContaining({ text: expect.stringContaining('Recebemos a sua mensagem') }),
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

    // The welcome went out, then the handoff notice (never a silent
    // handoff) — but no extra fallback beyond those two.
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiGenerated: false,
        text: 'Vou pedir a alguém da equipa que lhe responda. Fique atento, respondemos por aqui.',
      }),
    )
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(typeof (h.state.updatePayload as Record<string, unknown>)?.team_requested_at).toBe(
      'string',
    )
  })

  it('handoff (comercial) avisa a equipa por Mattermost e WhatsApp via notifyHandoff', async () => {
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

    expect(h.notifyHandoff).toHaveBeenCalledTimes(1)
    expect(h.notifyHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ARGS.accountId,
        conversationId: ARGS.conversationId,
        contactName: 'Ricardo Contacto',
        company: 'Acme Growth Lda',
        conversationUrl: expect.stringContaining(ARGS.conversationId),
      }),
    )
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

// ============================================================
// Bloco 3-A / migrações 050 + 051 — trava do handoff comercial.
//
// Regra do Ricardo: o agente comercial nunca marca a conversa como
// passada sem ter nome, email, motivo e o nome CONCRETO da empresa
// (não o sector) registados. É uma trava em código
// (commercial-handoff.ts), não só no prompt. Desde a correcção 3
// (21/09/2026), "passar" já não desliga o auto-reply — marca
// `team_requested_at` e o agente continua a responder até um humano
// escrever na conversa (ver send-message.ts). O modo interno (números
// da equipa) não é afectado — os testes deste bloco usam sempre
// `commercialConfig()`.
// ============================================================
describe('dispatchInboundToAiReply — Bloco 3-A trava do handoff (nome, email, motivo, empresa)', () => {
  beforeEach(() => {
    h.generateReplyWithTools.mockResolvedValue({
      text: '',
      handoff: true,
      usage: null,
      iterations: 1,
      hitIterationLimit: false,
    })
  })

  it('bloqueia o handoff quando falta o email — pede o que falta e não desliga o auto-reply', async () => {
    h.state.conv = commercialConv()
    h.state.contactEmail = null
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    await dispatchInboundToAiReply(ARGS)

    // Boas-vindas + o pedido do que falta — nunca a mensagem fixa de
    // handoff.
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiGenerated: false,
        text: expect.stringContaining('o seu email'),
      }),
    )
    expect(h.state.updatePayload).toEqual({ handoff_blocked_attempts: 1 })
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
  })

  it('bloqueia o handoff quando falta o nome', async () => {
    h.state.conv = commercialConv()
    h.state.contactName = null
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: expect.stringContaining('o seu nome') }),
    )
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
  })

  it('bloqueia o handoff quando falta o motivo de escalada', async () => {
    h.state.conv = commercialConv({ escalation_reason: null })
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: expect.stringContaining('o motivo do que precisa') }),
    )
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
  })

  it('bloqueia o handoff quando falta o nome da empresa (sector sozinho não conta)', async () => {
    h.state.conv = commercialConv()
    h.state.contactCompany = null
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: expect.stringContaining('o nome da empresa') }),
    )
    expect(h.state.updatePayload).toEqual({ handoff_blocked_attempts: 1 })
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).not.toHaveProperty('team_requested_at')
  })

  it('deixa passar o handoff normalmente quando nome, email, motivo e empresa estão todos registados', async () => {
    h.state.conv = commercialConv()
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: 'Vou pedir a alguém da equipa que lhe responda. Fique atento, respondemos por aqui.',
      }),
    )
    // Correcção 3 — já não desliga o auto-reply: marca team_requested_at.
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).not.toHaveProperty('handoff_incomplete')
    expect(typeof (h.state.updatePayload as Record<string, unknown>)?.team_requested_at).toBe(
      'string',
    )
    expect((h.state.updatePayload as Record<string, unknown>)?.ai_handoff_summary).toContain(
      'Acme Growth Lda',
    )
  })

  it('não repete o aviso de handoff quando a equipa já foi chamada nesta conversa', async () => {
    h.state.conv = commercialConv({
      team_requested_at: '2026-09-21T08:00:00.000Z',
      commercial_welcome_sent_at: '2026-09-21T07:55:00.000Z',
    })
    // Boas-vindas já enviadas nesta conversa real — perde a corrida do
    // claim atómico, isolando o teste ao que interessa: não repetir o
    // aviso de handoff.
    h.state.welcomeClaimed = false
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    // A única escrita nesta chamada é a tentativa (perdida) de claim da
    // boas-vindas — nada de handoff (nem team_requested_at, nem
    // ai_handoff_summary, nem ai_autoreply_disabled).
    expect(h.state.updatePayload).toEqual({
      commercial_welcome_sent_at: expect.any(String),
    })
  })

  it('duas tentativas bloqueadas seguidas fazem o handoff passar incompleto à terceira (válvula de escape)', async () => {
    h.loadAiConfig.mockResolvedValue(commercialConfig())

    // 1ª tentativa — bloqueada, conta sobe para 1.
    h.state.conv = commercialConv({ escalation_reason: null, handoff_blocked_attempts: 0 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toEqual({ handoff_blocked_attempts: 1 })
    expect(h.engineSendText).toHaveBeenCalledTimes(2) // boas-vindas + pedido

    // 2ª tentativa — ainda bloqueada, conta sobe para 2. A boas-vindas
    // já foi enviada na conversa real, por isso já não repete aqui.
    h.engineSendText.mockClear()
    h.state.welcomeClaimed = false
    h.state.conv = commercialConv({ escalation_reason: null, handoff_blocked_attempts: 1 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toEqual({ handoff_blocked_attempts: 2 })
    expect(h.engineSendText).toHaveBeenCalledTimes(1) // só o pedido

    // 3ª tentativa — válvula de escape: passa mesmo incompleto, em vez
    // de prender a pessoa a repetir dados que não quer dar.
    h.engineSendText.mockClear()
    h.state.conv = commercialConv({ escalation_reason: null, handoff_blocked_attempts: 2 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1) // a mensagem de handoff
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Vou pedir a alguém da equipa que lhe responda. Fique atento, respondemos por aqui.',
      }),
    )
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).toMatchObject({ handoff_incomplete: true })
    expect(typeof (h.state.updatePayload as Record<string, unknown>)?.team_requested_at).toBe(
      'string',
    )
  })

  it('respeita max_handoff_blocked_attempts configurado na conta em vez do valor por omissão', async () => {
    h.state.welcomeClaimed = false
    h.state.conv = commercialConv({ escalation_reason: null, handoff_blocked_attempts: 1 })
    h.loadAiConfig.mockResolvedValue(commercialConfig({ maxHandoffBlockedAttempts: 1 }))

    await dispatchInboundToAiReply(ARGS)

    // Com o limite da conta em 1, uma conversa que já tem 1 bloqueio
    // força a passagem nesta tentativa, em vez de esperar por 2.
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).toMatchObject({ handoff_incomplete: true })
    expect(typeof (h.state.updatePayload as Record<string, unknown>)?.team_requested_at).toBe(
      'string',
    )
  })

  it('o modo interno (número da equipa) nunca passa pela trava, mesmo sem nome/email/motivo', async () => {
    h.state.conv = commercialConv({ source: 'direct', escalation_reason: null })
    h.state.contactPhone = '351912345678'
    h.state.contactName = null
    h.state.contactEmail = null
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    h.loadAiConfig.mockResolvedValue(
      commercialConfig({ teamPhoneNumbers: ['351912345678'] }),
    )

    await dispatchInboundToAiReply(ARGS)

    // Assistente interno, sem boas-vindas comercial: handoff normal,
    // sem qualquer bloqueio, exactamente como antes desta migração.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Vou pedir a alguém da equipa que lhe responda. Fique atento, respondemos por aqui.',
      }),
    )
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload).not.toHaveProperty('handoff_incomplete')
  })
})
