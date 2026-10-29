import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  logAiUsage: vi.fn(),
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
  engineSendText: vi.fn(),
}))

vi.mock('./config', () => ({ loadAiConfig: mocks.loadAiConfig }))
vi.mock('./usage', () => ({ logAiUsage: mocks.logAiUsage }))
vi.mock('./providers/openai', () => ({ generateOpenAi: mocks.generateOpenAi }))
vi.mock('./providers/anthropic', () => ({ generateAnthropic: mocks.generateAnthropic }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: mocks.engineSendText }))

import {
  isWithinBusinessHours,
  getNextBusinessHourStart,
  findReactivationCandidates,
  evaluateAndExecuteReactivation,
  runContextualReactivationForAccount,
} from './reactivation-engine'
import {
  buildReactivationSystemPrompt,
  buildReactivationUserPrompt,
} from './reactivation-prompt'
import type { AiConfig } from './types'

interface ReactivationUpdatePayload {
  ai_reactivation_status?: string
  ai_reactivation_count?: number
  ai_reactivation_last_message_at?: string
  [key: string]: unknown
}

const BASE_CONFIG: AiConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test-key-mock',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 8,
  handoffAgentId: null,
  embeddingsApiKey: null,
  identityName: 'Clara',
  toneStyle: 'consultative_welcoming',
  businessHoursStart: '08:00',
  businessHoursEnd: '20:00',
}

describe('CONTEXTUAL REACTIVATION (Reativação de Conversas Interrompidas)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadAiConfig.mockResolvedValue(BASE_CONFIG)
    mocks.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid-123' })
  })

  // ============================================================
  // Estrutura do Prompt e Diretrizes de Comportamento
  // ============================================================
  it('verifies prompt rules: specific vs global hierarchy, silence ambiguity, and no spam/catalog dumping', () => {
    const sysPrompt = buildReactivationSystemPrompt({ identityName: 'Clara' })

    expect(sysPrompt).toContain('NÃO CONFUNDIR O ABANDONO DO EMPREENDIMENTO COM O ABANDONO DA NECESSIDADE')
    expect(sysPrompt).toContain('NÃO PRESUMIR INCOMPATIBILIDADE NEM ACUSAR O CLIENTE')
    expect(sysPrompt).toContain('NÍVEL 1 — REATIVAÇÃO ESPECÍFICA')
    expect(sysPrompt).toContain('NÍVEL 2 — REATIVAÇÃO GLOBAL')
    expect(sysPrompt).toContain('NÃO JOGAR O CLIENTE EM UM CATÁLOGO')
    expect(sysPrompt).toContain('FRONTEIRA ESTRITA DE DOMÍNIO IMOBILIÁRIO')
    expect(sysPrompt).toContain('É TERMINANTEMENTE PROIBIDO absorver, adotar ou inventar tópicos de outros mercados')
    expect(sysPrompt).toContain('CONTENÇÃO')
    expect(sysPrompt).toContain('não force uma frase de encerramento')
    expect(sysPrompt).toContain('Oi, você ainda está por aí?')
    expect(sysPrompt).toContain('Ficou alguma dúvida?')

    const userPrompt = buildReactivationUserPrompt({
      contactName: 'Carlos',
      propertyName: 'Live Park',
      propertyStage: 'Lançamento',
      messages: [
        { role: 'user', content: 'Quantos quartos tem?' },
        { role: 'assistant', content: 'O Live Park possui unidades de 1 quarto.' },
      ],
    })

    expect(userPrompt).toContain('Carlos')
    expect(userPrompt).toContain('Live Park')
    expect(userPrompt).toContain('Quantos quartos tem?')
    expect(userPrompt).toContain('O Live Park possui unidades de 1 quarto.')

    // Test prompt without property (no ad / no property linked)
    const userPromptNoProperty = buildReactivationUserPrompt({
      contactName: 'Giane',
      messages: [
        { role: 'user', content: 'Olá! Sou consultora do Instituto Fridrich...' },
      ],
    })
    expect(userPromptNoProperty).toContain('Empreendimento em foco: Nenhum (contato sem imóvel vinculado — mantenha estrita contenção imobiliária)')
  })

  // ============================================================
  // Horário Comercial e Agendamento (08:00 às 20:00)
  // ============================================================
  describe('Business Hours & Scheduling', () => {
    it('CENÁRIO E: 08:00 interaction -> 3 hours later (11:00) is within business hours', () => {
      // 11:00 BRT is 14:00 UTC
      const date11amBrt = new Date('2026-09-12T14:00:00.000Z')
      const isBusiness = isWithinBusinessHours(date11amBrt, BASE_CONFIG)
      expect(isBusiness).toBe(true)
    })

    it('CENÁRIO F: 19:00 interaction -> 3 hours later (22:00) is OUTSIDE business hours and schedules for 08:00 next day', () => {
      // 22:00 BRT is 01:00 UTC next day
      const date22pmBrt = new Date('2026-09-13T01:00:00.000Z')
      const isBusiness = isWithinBusinessHours(date22pmBrt, BASE_CONFIG)
      expect(isBusiness).toBe(false)

      const nextStart = getNextBusinessHourStart(date22pmBrt, BASE_CONFIG)
      // Next day 08:00 BRT is 11:00 UTC
      expect(nextStart.toISOString()).toBe('2026-09-13T11:00:00.000Z')
    })

    it('CENÁRIO G: 19:30 interaction -> 3 hours later (22:30) is OUTSIDE business hours and schedules for 08:00 next day', () => {
      // 22:30 BRT is 01:30 UTC next day
      const date2230pmBrt = new Date('2026-09-13T01:30:00.000Z')
      const isBusiness = isWithinBusinessHours(date2230pmBrt, BASE_CONFIG)
      expect(isBusiness).toBe(false)

      const nextStart = getNextBusinessHourStart(date2230pmBrt, BASE_CONFIG)
      expect(nextStart.toISOString()).toBe('2026-09-13T11:00:00.000Z')
    })
  })

  // ============================================================
  // Avaliação Contextual e Cenários de Conversa
  // ============================================================
  describe('Conversational Reactivation Scenarios (A through L)', () => {
    function buildMockDb(opts: {
      conversation: Record<string, unknown>
      messages: Array<{ id: string; sender_type: 'customer' | 'bot' | 'agent'; content_text: string; created_at: string }>
      onUpdate?: (payload: Record<string, unknown>) => void
    }) {
      return {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.conversation,
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockImplementation((payload) => {
                if (opts.onUpdate) opts.onUpdate(payload)
                return {
                  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
                }
              }),
            }
          }
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: opts.messages.map((m) => ({
                          sender_type: m.sender_type,
                          content_type: 'text',
                          content_text: m.content_text,
                          transcript_text: null,
                        })),
                        error: null,
                      }),
                    }),
                  }),
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: opts.messages,
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { user_id: 'owner-user-id' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }),
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      } as unknown as SupabaseClient
    }

    // CENÁRIO A: Cliente conversa normalmente e deixa de responder -> Reativação global natural
    it('CENÁRIO A: Regular conversation interrupted after 3h sends natural global reactivation', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'global',
          detected_need_or_clue: null,
          reason: 'Cliente parou de responder há 3 horas após dúvidas gerais; reativação global acolhedora.',
          message_text: 'Oi, Carlos! Passando para ver como posso te ajudar a avançar na escolha do seu imóvel. Se quiser tirar mais alguma dúvida ou avaliar pontos importantes para você, estou por aqui!',
        }),
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      })

      const tracker = { updatedPayload: null as ReactivationUpdatePayload | null }
      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-1',
          account_id: 'acc-1',
          contact_id: 'cont-1',
          property_id: 'prop-1',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-1', name: 'Carlos', phone: '+5583999999999' },
          property: { id: 'prop-1', name: 'Live Park', stage: 'Lançamento' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Boa tarde!', created_at: '2026-09-12T10:55:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'Boa tarde, Carlos! Como posso te ajudar?', created_at: '2026-09-12T10:56:00.000Z' },
        ],
        onUpdate: (payload) => {
          tracker.updatedPayload = payload as ReactivationUpdatePayload
        },
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-1', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.messageText).toContain('Carlos')
      expect(mocks.engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          text: expect.stringContaining('Carlos'),
          aiGenerated: true,
        }),
      )
      expect(tracker.updatedPayload?.ai_reactivation_status).toBe('sent')
      expect(tracker.updatedPayload?.ai_reactivation_count).toBe(1)
    })

    // CENÁRIO B: Cliente pergunta quantos quartos -> Clara responde que tem 1 quarto -> silêncio
    // A reativação aproveita o contexto e tenta descobrir a necessidade de quartos sem acusar
    it('CENÁRIO B: Inactivity after bedroom query explores bedroom need without accusing incompatibility', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'specific',
          detected_need_or_clue: 'Cliente perguntou sobre quartos antes do silêncio.',
          reason: 'Explorar a necessidade de espaço e dormitórios sem presumir que o silêncio foi recusa.',
          message_text: 'Esse projeto possui 1 quarto. Para eu entender melhor o que você procura: você precisa de quantos quartos no imóvel?',
        }),
        usage: { promptTokens: 120, completionTokens: 35, totalTokens: 155 },
      })

      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-2',
          account_id: 'acc-1',
          contact_id: 'cont-2',
          property_id: 'prop-1',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-2', name: 'Marina', phone: '+5583999999999' },
          property: { id: 'prop-1', name: 'Live Park', stage: 'Lançamento' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Quantos quartos tem?', created_at: '2026-09-12T10:55:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'Esse projeto possui 1 quarto.', created_at: '2026-09-12T11:00:00.000Z' },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-2', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.decision?.reactivation_type).toBe('specific')
      expect(res.messageText).toContain('você precisa de quantos quartos')
      expect(res.messageText).not.toContain('como você não gostou')
    })

    // CENÁRIO C: Cliente pergunta se está pronto -> Descobre que está em construção -> silêncio
    // A Clara explora a possibilidade de ele estar buscando algo pronto sem assumir o motivo
    it('CENÁRIO C: Inactivity after stage query explores ready vs under construction options', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'specific',
          detected_need_or_clue: 'Cliente perguntou se estava pronto antes do silêncio.',
          reason: 'Verificar se o cliente busca imóvel já pronto sem presumir que isso encerrou o interesse.',
          message_text: 'Esse empreendimento ainda está em construção. Caso você esteja buscando algo já pronto, também podemos olhar outras opções que estejam mais alinhadas ao que você procura.',
        }),
        usage: { promptTokens: 130, completionTokens: 45, totalTokens: 175 },
      })

      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-3',
          account_id: 'acc-1',
          contact_id: 'cont-3',
          property_id: 'prop-1',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-3', name: 'Rodrigo', phone: '+5583999999999' },
          property: { id: 'prop-1', name: 'Live Park', stage: 'Lançamento' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Já está pronto?', created_at: '2026-09-12T10:55:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'Esse empreendimento ainda está em construção.', created_at: '2026-09-12T11:00:00.000Z' },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-3', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.decision?.reactivation_type).toBe('specific')
      expect(res.messageText).toContain('Caso você esteja buscando algo já pronto')
    })

    // CENÁRIO D: Cliente buscando locação por temporada -> Empreendimento não atende -> Clara abre leque contextual
    it('CENÁRIO D: Inactivity after seasonal rental query explores short-stay profile without dump catalog', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'specific',
          detected_need_or_clue: 'Cliente procura imóvel para temporada / Airbnb.',
          reason: 'Conectar com a necessidade de rentabilidade por temporada sem despejar catálogo.',
          message_text: 'Como você comentou sobre temporada, posso verificar também outras opções que tenham exatamente esse perfil de locação. Você tem preferência por alguma praia específica em João Pessoa?',
        }),
        usage: { promptTokens: 130, completionTokens: 45, totalTokens: 175 },
      })

      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-4',
          account_id: 'acc-1',
          contact_id: 'cont-4',
          property_id: 'prop-1',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-4', name: 'Patrícia', phone: '+5583999999999' },
          property: { id: 'prop-1', name: 'Live Park', stage: 'Lançamento' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Quero para temporada no Airbnb.', created_at: '2026-09-12T10:50:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'Esse prédio é mais voltado para moradia residencial anual.', created_at: '2026-09-12T11:00:00.000Z' },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-4', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.decision?.reactivation_type).toBe('specific')
      expect(res.messageText).toContain('Como você comentou sobre temporada')
    })

    // CENÁRIO H: Cliente responde antes das 3 horas -> A reativação automática deve ser cancelada
    it('CENÁRIO H: Customer replies before reactivation dispatch cancels pending scheduled reactivation', async () => {
      const tracker = { updatedPayload: null as ReactivationUpdatePayload | null }
      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-h',
          account_id: 'acc-1',
          contact_id: 'cont-h',
          last_message_at: '2026-09-12T14:00:00.000Z', // newer message
          ai_reactivation_status: 'scheduled',
          ai_reactivation_last_message_at: '2026-09-12T10:00:00.000Z', // evaluated earlier
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-h', name: 'Lucas', phone: '+5583999999999' },
        },
        messages: [
          { id: 'm1', sender_type: 'bot', content_text: 'Olá!', created_at: '2026-09-12T10:00:00.000Z' },
          { id: 'm2', sender_type: 'customer', content_text: 'Voltei! Esqueci de perguntar o valor do condomínio.', created_at: '2026-09-12T14:00:00.000Z' },
        ],
        onUpdate: (payload) => {
          tracker.updatedPayload = payload as ReactivationUpdatePayload
        },
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-h', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('cancelled_customer_replied')
      expect(mocks.engineSendText).not.toHaveBeenCalled()
      expect(tracker.updatedPayload?.ai_reactivation_status).toBe('cancelled')
    })

    // CENÁRIO I: Um humano assume a conversa antes da reativação -> Não disparar mensagem automática
    it('CENÁRIO I: Human agent takeover cancels and suppresses AI reactivation', async () => {
      const tracker = { updatedPayload: null as ReactivationUpdatePayload | null }
      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-i',
          account_id: 'acc-1',
          contact_id: 'cont-i',
          last_message_at: '2026-09-12T10:00:00.000Z',
          ai_reactivation_status: 'scheduled',
          ai_reactivation_count: 0,
          assigned_agent_id: 'agent-human-uuid', // Human took over!
          ai_autoreply_disabled: true,
          status: 'open',
          contact: { id: 'cont-i', name: 'Beatriz', phone: '+5583999999999' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Quero falar com um corretor.', created_at: '2026-09-12T09:50:00.000Z' },
          { id: 'm2', sender_type: 'agent', content_text: 'Olá, sou o Ronaldo, vou continuar seu atendimento.', created_at: '2026-09-12T10:00:00.000Z' },
        ],
        onUpdate: (payload) => {
          tracker.updatedPayload = payload as ReactivationUpdatePayload
        },
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-i', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('cancelled_human_assigned')
      expect(mocks.engineSendText).not.toHaveBeenCalled()
      expect(tracker.updatedPayload?.ai_reactivation_status).toBe('cancelled')
    })

    // CENÁRIO J: Não existe qualquer pista contextual -> Reativação global sem inventar contexto
    it('CENÁRIO J: No contextual clue triggers Level 2 Global reactivation without hallucinating context', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'global',
          detected_need_or_clue: null,
          reason: 'Apenas saudação inicial antes do silêncio; aplicando reativação global neutra.',
          message_text: 'Olá! Passando para ver se você gostaria de explorar mais detalhes sobre as opções disponíveis ou se há alguma característica essencial para o imóvel que você procura.',
        }),
        usage: { promptTokens: 90, completionTokens: 35, totalTokens: 125 },
      })

      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-j',
          account_id: 'acc-1',
          contact_id: 'cont-j',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-j', name: 'Tiago', phone: '+5583999999999' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Olá', created_at: '2026-09-12T10:59:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'Olá! Tudo bem? Como posso te ajudar hoje?', created_at: '2026-09-12T11:00:00.000Z' },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-j', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.decision?.reactivation_type).toBe('global')
      expect(res.decision?.detected_need_or_clue).toBeNull()
      expect(res.messageText).toContain('explorar mais detalhes')
    })

    // CENÁRIO K: Cliente permanece em silêncio após a primeira tentativa -> Spam guard impede sequência infinita
    it('CENÁRIO K: Continued silence after first reactivation triggers spam guard and avoids repeat messages', async () => {
      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-k',
          account_id: 'acc-1',
          contact_id: 'cont-k',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: 'sent', // already sent!
          ai_reactivation_sent_at: '2026-09-12T14:00:00.000Z', // sent after last message
          ai_reactivation_count: 1,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-k', name: 'Juliana', phone: '+5583999999999' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Obrigado', created_at: '2026-09-12T10:55:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'Disponha sempre!', created_at: '2026-09-12T11:00:00.000Z' },
          { id: 'm3', sender_type: 'bot', content_text: 'Olá, Juliana! Passando para ver...', created_at: '2026-09-12T14:00:00.000Z' },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-k', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('skipped_spam_guard')
      expect(mocks.engineSendText).not.toHaveBeenCalled()
    })

    // CENÁRIO L: Cliente havia demonstrado interesse forte antes do silêncio -> Reativação reflete interesse sem pressionar
    it('CENÁRIO L: Prior strong interest is reflected respectfully in reactivation without being pushy', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'specific',
          detected_need_or_clue: 'Cliente adorou a planta com varanda e proximidade do mar.',
          reason: 'Aproveitar o forte entusiasmo demonstrado anteriormente com acolhimento.',
          message_text: 'Oi, Fernando! Lembrei de você porque comentou que adorou a varanda pertinho da praia. Quando tiver um tempinho, se quiser podemos alinhar mais detalhes sobre a disponibilidade dessa unidade!',
        }),
        usage: { promptTokens: 140, completionTokens: 45, totalTokens: 185 },
      })

      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-l',
          account_id: 'acc-1',
          contact_id: 'cont-l',
          property_id: 'prop-1',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-l', name: 'Fernando', phone: '+5583999999999' },
          property: { id: 'prop-1', name: 'Live Park', stage: 'Lançamento' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Achei maravilhosa a planta com varanda pertinho da praia!', created_at: '2026-09-12T10:50:00.000Z' },
          { id: 'm2', sender_type: 'bot', content_text: 'É realmente um dos pontos mais elogiados do Live Park!', created_at: '2026-09-12T11:00:00.000Z' },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-l', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.decision?.reactivation_type).toBe('specific')
      expect(res.messageText).toContain('varanda pertinho da praia')
      expect(res.messageText).not.toContain('Por que você sumiu?')
    })

    // CENÁRIO EXTRA: Cliente deu opt-out explícito ("não tenho interesse") -> Cancelado sem mensagem
    it('Explicit opt-out from customer cancels reactivation without sending message', async () => {
      const tracker = { updatedPayload: null as ReactivationUpdatePayload | null }
      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-opt-out',
          account_id: 'acc-1',
          contact_id: 'cont-opt',
          last_message_at: '2026-09-12T11:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-opt', name: 'Marcos', phone: '+5583999999999' },
        },
        messages: [
          { id: 'm1', sender_type: 'customer', content_text: 'Obrigado, já comprei outro apartamento e não tenho mais interesse.', created_at: '2026-09-12T11:00:00.000Z' },
        ],
        onUpdate: (payload) => {
          tracker.updatedPayload = payload as ReactivationUpdatePayload
        },
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-opt-out', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('cancelled_explicit_opt_out')
      expect(mocks.engineSendText).not.toHaveBeenCalled()
      expect(tracker.updatedPayload?.ai_reactivation_status).toBe('cancelled')
    })

    // CENÁRIO M: Contato fez prospecção externa (cursos/estética/vendas B2B) -> Descartado sem reativar
    it('CENÁRIO M: External vendor / course sales pitch is discarded without sending reactivation', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: false,
          reactivation_type: 'none',
          detected_need_or_clue: null,
          reason: 'Contato é consultora oferecendo cursos de estética de outra instituição, sem interesse imobiliário.',
          message_text: '',
        }),
        usage: { promptTokens: 120, completionTokens: 35, totalTokens: 155 },
      })

      const tracker = { updatedPayload: null as ReactivationUpdatePayload | null }
      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-vendor-pitch',
          account_id: 'acc-1',
          contact_id: 'cont-vendor',
          last_message_at: '2026-09-15T18:08:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-vendor', name: 'Giane -IF comercial', phone: '+558388543404' },
          property: null,
        },
        messages: [
          {
            id: 'm1',
            sender_type: 'customer',
            content_text: 'Olá! Seja muito bem-vinda ao Instituto Fridrich! Me chamo Giane e sou Consultora de vendas... você já atua na área da estética?',
            created_at: '2026-09-15T18:07:00.000Z',
          },
          {
            id: 'm2',
            sender_type: 'bot',
            content_text: 'Olá, Giane! 😊 Sou a Clara, assistente da equipe do Ronaldo Meira. Como posso te ajudar hoje?',
            created_at: '2026-09-15T18:08:00.000Z',
          },
        ],
        onUpdate: (payload) => {
          tracker.updatedPayload = payload as ReactivationUpdatePayload
        },
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-vendor-pitch', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('skipped_not_appropriate')
      expect(mocks.engineSendText).not.toHaveBeenCalled()
      expect(tracker.updatedPayload?.ai_reactivation_status).toBe('skipped')
    })

    // CENÁRIO N: Contato sem contexto recebe uma abertura natural sem frase final obrigatória
    it('CENÁRIO N: Lead without property/ad context gets a natural global opening without a forced ending', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'global',
          detected_need_or_clue: null,
          reason: 'Contato inicial genérico sem anúncio vinculado, aplicando regra de contenção.',
          message_text: 'Oi, Juliana! Tudo bem? Se quiser retomar sua busca por um imóvel, posso ajudar.',
        }),
        usage: { promptTokens: 110, completionTokens: 30, totalTokens: 140 },
      })

      const mockDb = buildMockDb({
        conversation: {
          id: 'conv-no-ad-context',
          account_id: 'acc-1',
          contact_id: 'cont-no-ad',
          last_message_at: '2026-09-15T18:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          status: 'open',
          contact: { id: 'cont-no-ad', name: 'Juliana', phone: '+5583999999999' },
          property: null,
        },
        messages: [
          {
            id: 'm1',
            sender_type: 'customer',
            content_text: 'Oi',
            created_at: '2026-09-15T17:59:00.000Z',
          },
          {
            id: 'm2',
            sender_type: 'bot',
            content_text: 'Olá, Juliana! 😊 Sou a Clara, assistente da equipe do Ronaldo Meira. Como posso te ajudar hoje?',
            created_at: '2026-09-15T18:00:00.000Z',
          },
        ],
      })

      const res = await evaluateAndExecuteReactivation(mockDb, 'conv-no-ad-context', {
        simulatedHours: 'business_hours',
      })

      expect(res.outcome).toBe('sent')
      expect(res.decision?.reactivation_type).toBe('global')
      expect(res.messageText).toContain('Se quiser retomar sua busca por um imóvel, posso ajudar.')
      expect(res.messageText).not.toContain('área da estética')
      expect(res.messageText).not.toContain('posso te orientar')
      expect(mocks.engineSendText).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================
  // Candidate Discovery & Batch Runner Tests
  // ============================================================
  describe('Candidate Discovery & Account Batch Runner', () => {
    it('findReactivationCandidates selects conversations with >= 3h inactivity and filters out closed/handed-off threads', async () => {
      const now = new Date('2026-09-12T14:00:00.000Z')
      const mockRows = [
        {
          id: 'c1',
          account_id: 'acc-1',
          contact_id: 'ct-1',
          last_message_at: '2026-09-12T10:00:00.000Z', // 4h ago -> valid candidate
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          ai_transfer_status: null,
          status: 'open',
          contact: { id: 'ct-1', name: 'Ana', phone: '+5583999999999' },
        },
        {
          id: 'c2',
          account_id: 'acc-1',
          contact_id: 'ct-2',
          last_message_at: '2026-09-12T08:00:00.000Z',
          ai_reactivation_status: 'sent',
          ai_reactivation_sent_at: '2026-09-12T11:00:00.000Z', // already sent, silence continues -> should be filtered
          ai_reactivation_count: 1,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          ai_transfer_status: null,
          status: 'open',
          contact: { id: 'ct-2', name: 'Beto', phone: '+5583999999999' },
        },
      ]

      const db = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    lte: vi.fn().mockReturnValue({
                      gte: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          limit: vi.fn().mockResolvedValue({
                            data: mockRows,
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseClient

      const candidates = await findReactivationCandidates(db, 'acc-1', { now })

      expect(candidates).toHaveLength(1)
      expect(candidates[0].id).toBe('c1')
    })

    it('runContextualReactivationForAccount executes candidates and returns structured run result', async () => {
      mocks.generateOpenAi.mockResolvedValueOnce({
        text: JSON.stringify({
          should_reactivate: true,
          reactivation_type: 'global',
          detected_need_or_clue: null,
          reason: 'Global follow-up',
          message_text: 'Olá! Passando para ver como posso te ajudar com o imóvel.',
        }),
        usage: { promptTokens: 90, completionTokens: 30, totalTokens: 120 },
      })

      const now = new Date('2026-09-12T14:00:00.000Z')
      const mockCandidateRows = [
        {
          id: 'conv-batch-1',
          account_id: 'acc-1',
          contact_id: 'ct-1',
          last_message_at: '2026-09-12T10:00:00.000Z',
          ai_reactivation_status: null,
          ai_reactivation_count: 0,
          assigned_agent_id: null,
          ai_autoreply_disabled: false,
          ai_transfer_status: null,
          status: 'open',
          contact: { id: 'ct-1', name: 'Carla', phone: '+5583999999999' },
        },
      ]

      const db = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation((col: string) => {
                  if (col === 'account_id') {
                    return {
                      neq: vi.fn().mockReturnValue({
                        is: vi.fn().mockReturnValue({
                          eq: vi.fn().mockReturnValue({
                            lte: vi.fn().mockReturnValue({
                              gte: vi.fn().mockReturnValue({
                                order: vi.fn().mockReturnValue({
                                  limit: vi.fn().mockResolvedValue({
                                    data: mockCandidateRows,
                                    error: null,
                                  }),
                                }),
                              }),
                            }),
                          }),
                        }),
                      }),
                    }
                  }
                  return {
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: mockCandidateRows[0],
                      error: null,
                    }),
                  }
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [{ sender_type: 'customer', content_type: 'text', content_text: 'Olá', transcript_text: null }],
                        error: null,
                      }),
                    }),
                  }),
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ id: 'm1', sender_type: 'customer', content_text: 'Olá', created_at: '2026-09-12T10:00:00.000Z' }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { user_id: 'owner-id' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }),
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      } as unknown as SupabaseClient

      const runRes = await runContextualReactivationForAccount(db, 'acc-1', {
        now,
        simulatedHours: 'business_hours',
      })

      expect(runRes.candidates).toBe(1)
      expect(runRes.evaluated).toBe(1)
      expect(runRes.sent).toBe(1)
      expect(mocks.engineSendText).toHaveBeenCalledTimes(1)
    })
  })
})
