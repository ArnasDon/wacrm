import { describe, it, expect } from 'vitest'
import type { AiConfig } from './types'
import { getBusinessHoursContext } from './business-hours'
import { buildConversationalSystemPrompt } from './prompt-builder'
import { parseStructuredDecision } from './conversation-engine'

const baseConfig: AiConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 20,
  handoffAgentId: null,
  embeddingsApiKey: null,
  systemPrompt: 'Você é a Clara.',
  toneStyle: 'consultative',
  identityName: 'Clara',
  businessHoursStart: '08:00',
  businessHoursEnd: '20:00',
  businessDays: [1, 2, 3, 4, 5],
  teamPresentation: 'Somos a equipe do Ronaldo Meira e da Thatianna.',
}

describe('WACRM — Off-Hours Conversational Continuity & Decision Logic', () => {
  // ============================================================
  // TESTE 1: 23:14 — Fora do horário comercial (Donna Griffe scenario)
  // ============================================================
  it('TESTE 1: 23:14 — off-hours lead qualification and explicit next business period handoff', () => {
    const offHoursDate = new Date('2026-09-11T23:14:00-03:00')
    const ctx = getBusinessHoursContext(baseConfig, offHoursDate)

    expect(ctx.isBusinessHours).toBe(false)
    expect(ctx.instructionForModel).toContain('FORA DO EXPEDIENTE COMERCIAL')
    expect(ctx.instructionForModel).toContain('NO PRÓXIMO HORÁRIO COMERCIAL')

    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: ctx,
      property: { id: 'prop-1', name: 'Puerto Ventura' },
    })

    // Verifies anti-vague rule and off-hours continuity
    expect(prompt).toContain('informe apenas o que realmente acontecerá')
    expect(prompt).toContain('conforme o horário comercial')
    expect(prompt).toContain('Transfira quando a solicitação exigir decisão humana')
    expect(prompt).toContain('NO PRÓXIMO HORÁRIO COMERCIAL')
  })

  // ============================================================
  // TESTE 2: 23:00 — Cliente responde "Ok" após mensagem de encaminhamento (Matheus scenario 1)
  // ============================================================
  it('TESTE 2: 23:00 — short confirmation ("Ok") after handoff concludes cleanly without repetitive looping', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: getBusinessHoursContext(baseConfig, new Date('2026-09-11T23:00:00-03:00')),
      property: { id: 'prop-livepark', name: 'Live Park' },
    })

    expect(prompt).toContain('Responda confirmações curtas sem reabrir a qualificação')
    expect(prompt).toContain('não repita perguntas respondidas')

    // Model concluding off-hours turn properly with transfer_required = true
    const modelOutput = JSON.stringify({
      response_text:
        'Perfeito! Já deixei tudo registrado por aqui com foco em renda de aluguel. Como estamos fora do horário comercial, nossa equipe dará continuidade ao seu atendimento no próximo horário comercial. 😊',
      transfer_required: true,
      boundary_type: 'commercial_decision',
      reason: 'Triagem concluída fora do horário comercial',
      context_summary: 'Cliente busca imóvel para renda com aluguel',
      suggested_next_action: 'Apresentar opções de temporada no início do expediente',
    })

    const decision = parseStructuredDecision(modelOutput)
    expect(decision.transfer_required).toBe(true)
    expect(decision.response_text).toContain('próximo horário comercial')
    expect(decision.response_text).not.toContain('no próximo passo')
  })

  // ============================================================
  // TESTE 3: 23:01 — Cliente responde "Ok" novamente (Matheus scenario 2)
  // ============================================================
  it('TESTE 3: 23:01 — subsequent "Ok" is acknowledged minimally without re-triggering registration monologue', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: getBusinessHoursContext(baseConfig, new Date('2026-09-11T23:01:00-03:00')),
    })

    expect(prompt).toContain('Responda confirmações curtas sem reabrir a qualificação')
  })

  // ============================================================
  // TESTE 4: 14:00 — Dentro do horário comercial, cliente sendo qualificado
  // ============================================================
  it('TESTE 4: 14:00 — active business hours actively qualifies with relevant questions and NO off-hours note', () => {
    const dayDate = new Date('2026-09-11T14:00:00-03:00')
    const ctx = getBusinessHoursContext(baseConfig, dayDate)

    expect(ctx.isBusinessHours).toBe(true)
    expect(ctx.instructionForModel).toContain('HORÁRIO COMERCIAL ATIVO')
    expect(ctx.instructionForModel).toContain('NUNCA mencione "próximo horário comercial"')

    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: ctx,
    })

    expect(prompt).toContain('informe com clareza que nossa equipe dará continuidade ao atendimento e passe o bastão')
  })

  // ============================================================
  // TESTE 5: 14:00 — Dentro do horário comercial, handoff imediato
  // ============================================================
  it('TESTE 5: 14:00 — daytime handoff connects to team immediately without mentioning next period', () => {
    const modelOutput = JSON.stringify({
      response_text:
        'Para te passar a tabela completa com as condições de pagamento e valores atualizados, vou direcionar nossa conversa para o Ronaldo ou a Thatianna, que já dão sequência com você por aqui!',
      transfer_required: true,
      boundary_type: 'payment_terms',
      reason: 'Cliente solicitou fluxo de pagamento',
      context_summary: 'Dúvida sobre parcelamento e chaves',
      suggested_next_action: 'Enviar tabela e simulação',
    })

    const decision = parseStructuredDecision(modelOutput)
    expect(decision.transfer_required).toBe(true)
    expect(decision.response_text).not.toContain('próximo horário comercial')
    expect(decision.response_text).not.toContain('no próximo passo')
  })

  // ============================================================
  // TESTE 6: Cliente ainda possui informação importante para ser descoberta
  // ============================================================
  it('TESTE 6: Guiding question is asked when qualification has relevant unexplored facts', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: getBusinessHoursContext(baseConfig, new Date('2026-09-11T23:14:00-03:00')),
      property: { id: 'p1', name: 'Live Park' },
    })

    expect(prompt).toContain('Faça uma pergunta por vez apenas quando a resposta ajudar')
    expect(prompt).toContain('Use o contexto já dado')
    expect(prompt).toContain('não repita perguntas respondidas')
  })
})
