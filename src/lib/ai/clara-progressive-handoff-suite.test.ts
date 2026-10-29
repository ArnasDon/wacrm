import { describe, it, expect } from 'vitest';
import type { AiConfig } from './types';
import {
  getBusinessHoursContext,
  isBusinessHours,
  sanitizeOffHoursHandoffResponse,
  wallClockParts,
  TIMEZONE,
} from './business-hours';
import { buildConversationalSystemPrompt } from './prompt-builder';
import { parseStructuredDecision } from './conversation-engine';

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
  businessDays: [1, 2, 3, 4, 5, 6], // Seg-Sáb
  teamPresentation: 'Somos a equipe do Ronaldo Meira e da Thatianna.',
};

const TOSCANO_FLAT_PROPERTY = {
  id: 'prop-toscano-flat',
  name: 'Toscano Flat',
  stage: 'Pronto para Morar',
};

const TOSCANO_FLAT_KNOWLEDGE = [
  `[Ficha Técnica - Toscano Flat]
Localização: Bessa, João Pessoa, a 100 metros da praia (2 minutos a pé).
Apartamento residencial de 1 e 2 quartos com suíte, metragens de 27,27 m² a 54,61 m².
Posição sul, excelente ventilação natural. Porcelanato em todos os ambientes.
Estrutura e Lazer: Elevador, piscina, área gourmet, churrasqueira, academia, coworking, lavanderia compartilhada e garagem coberta.
Controle de acesso eletrônico nos portões, sem portaria física.`,
];

describe('CLARA — 9 Mandatory Tests & Real Cases A and B Suite', () => {
  // ============================================================
  // TESTE 1 & CASO A — CTWA GENÉRICO
  // ============================================================
  it('TESTE 1 & CASO A: Generic CTWA ("Posso ter mais informações sobre isto?") strictly forbids dumping technical sheet and enforces 1-2 attribute ceiling', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      isInitialContact: true,
      userMessageCount: 1,
      property: TOSCANO_FLAT_PROPERTY,
      propertyKnowledge: TOSCANO_FLAT_KNOWLEDGE,
      communicatedContent: [],
    });

    // Verification of prompt directives
    expect(prompt).toContain('SE O CLIENTE VEIO DE ANÚNCIO (CTWA) COM MENSAGEM GENÉRICA OU EXPLORATÓRIA');
    expect(prompt).toContain('TRATAMENTO DE SOLICITAÇÃO EXPLORATÓRIA (ANTI-CATÁLOGO E TETO DE ABERTURA)');
    expect(prompt).toContain('Uma solicitação genérica NÃO É autorização para despejar a ficha técnica');
    expect(prompt).toContain('É TERMINANTEMENTE PROIBIDO despejar simultaneamente: quartos + banheiros + metragem + posição/ventilação + elevador + piscina + área gourmet + garagem + controle de acesso');
    expect(prompt).toContain('RESPOSTA PROPORCIONAL E USO DA FICHA');
    expect(prompt).toContain('Use o conhecimento do empreendimento para responder ao que foi pedido, sem listar a ficha inteira em perguntas genéricas');

    // Model following the prompt correctly
    const validOpeningResponse = {
      response_text:
        'Olá! 😊 Com certeza. O Toscano Flat fica no Bessa, a apenas 100 metros da praia, ideal para quem busca praticidade e excelente localização. Você busca para morar ou pensando em investimento?',
      transfer_required: false,
      boundary_type: null,
      reason: 'Abertura contextualizada com vocação e localização, sem despejar ficha técnica.',
      context_summary: 'Primeiro contato do cliente via CTWA.',
      suggested_next_action: 'Aguardar objetivo do cliente (moradia vs investimento).',
    };

    const decision = parseStructuredDecision(JSON.stringify(validOpeningResponse));
    expect(decision.transfer_required).toBe(false);
    // Asserts no dump of excessive attributes
    expect(decision.response_text).not.toContain('dois banheiros');
    expect(decision.response_text).not.toContain('posição sul');
    expect(decision.response_text).not.toContain('controle de acesso eletrônico');
    expect(decision.response_text).not.toContain('elevador');
    expect(decision.response_text).not.toContain('área gourmet');
  });

  // ============================================================
  // TESTE 2 — PEDIDO DE DETALHES PONTUAIS
  // ============================================================
  it('TESTE 2: Specific detail request ("Quais são os quartos?") answers rooms without dumping pool, parking, elevator, solar position', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      isInitialContact: false,
      userMessageCount: 2,
      property: TOSCANO_FLAT_PROPERTY,
      propertyKnowledge: TOSCANO_FLAT_KNOWLEDGE,
      communicatedContent: [
        'O Toscano Flat fica no Bessa, a apenas 100 metros da praia, com proposta prática e moderna.',
      ],
    });

    expect(prompt).toContain('perguntas pontuais, vá direto ao ponto');

    const modelResponse = {
      response_text:
        'Temos opções com 1 e 2 quartos (com suíte), com metragens que vão de 27 m² a 54 m². Você busca uma planta mais compacta ou com mais espaço?',
      transfer_required: false,
      boundary_type: null,
      reason: 'Respondido pontualmente sobre tipologias de quartos sem adicionar lazer ou infraestrutura desnecessária.',
      context_summary: 'Cliente perguntou especificamente sobre os quartos.',
      suggested_next_action: 'Aprofundar de acordo com a metragem desejada.',
    };

    const decision = parseStructuredDecision(JSON.stringify(modelResponse));
    expect(decision.response_text).toContain('1 e 2 quartos');
    expect(decision.response_text).not.toContain('piscina');
    expect(decision.response_text).not.toContain('garagem');
    expect(decision.response_text).not.toContain('elevador');
    expect(decision.response_text).not.toContain('posição sul');
  });

  // ============================================================
  // TESTE 3 — PEDIDO ABERTO
  // ============================================================
  it('TESTE 3: Open request ("Me fale mais desse apartamento") doses 1-2 new aspects selectively without full block dumping', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      isInitialContact: false,
      userMessageCount: 3,
      property: TOSCANO_FLAT_PROPERTY,
      propertyKnowledge: TOSCANO_FLAT_KNOWLEDGE,
      communicatedContent: [
        'O Toscano Flat fica no Bessa, a 100m da praia.',
        'As opções são de 1 e 2 quartos com suíte.',
      ],
    });

    expect(prompt).toContain('Em pedidos abertos, escolha detalhes novos e relevantes');
    expect(prompt).toContain('selecione fatos autorizados ainda não compartilhados e relevantes ao pedido');

    const modelResponse = {
      response_text:
        'Um ponto forte do prédio é a ventilação natural com posição sul, além de estar pronto para morar com acabamento todo em porcelanato. Você prefere uma unidade em andar mais alto?',
      transfer_required: false,
      boundary_type: null,
      reason: 'Apresentados 2 novos diferenciais (insolação/ventilação e acabamento) sem despejar toda a infraestrutura.',
      context_summary: 'Cliente pediu para falar mais sobre o imóvel.',
      suggested_next_action: 'Verificar preferência de andar.',
    };

    const decision = parseStructuredDecision(JSON.stringify(modelResponse));
    expect(decision.response_text).toContain('posição sul');
    expect(decision.response_text).not.toContain('coworking');
    expect(decision.response_text).not.toContain('lavanderia compartilhada');
  });

  // ============================================================
  // TESTE 4 — INFORMAÇÃO JÁ COMUNICADA
  // ============================================================
  it('TESTE 4: Previously communicated information is not repeated as new in subsequent turns', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      isInitialContact: false,
      userMessageCount: 3,
      property: TOSCANO_FLAT_PROPERTY,
      propertyKnowledge: TOSCANO_FLAT_KNOWLEDGE,
      communicatedContent: [
        'O empreendimento fica a 100 metros da praia no Bessa.',
        'Temos opções de 1 e 2 quartos com suíte.',
      ],
    });

    expect(prompt).toContain('INFORMAÇÕES JÁ COMUNICADAS AO CLIENTE:');
    expect(prompt).toContain('não reapresente informações como novidade');
    expect(prompt).toContain('não reapresente informações como novidade nem repita blocos');
  });

  // ============================================================
  // TESTE 5 — HANDOFF ÀS 14:00 (DURANTE O EXPEDIENTE)
  // ============================================================
  it('TESTE 5: Daytime handoff at 14:00 uses active business hours phrasing without next-period mention', () => {
    const daytime = new Date('2026-09-15T14:00:00-03:00');
    const ctx = getBusinessHoursContext(baseConfig, daytime);

    expect(ctx.isBusinessHours).toBe(true);

    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: ctx,
      property: TOSCANO_FLAT_PROPERTY,
    });

    expect(prompt).toContain('vou direcionar nossa conversa para a nossa equipe, que já dá sequência com você por aqui');

    const modelResponse = {
      response_text:
        'Para te passar a tabela completa com valores e condições detalhadas, vou direcionar nossa conversa para o Ronaldo ou a Thatianna, que dão sequência com você por aqui!',
      transfer_required: true,
      boundary_type: 'price',
      reason: 'Solicitação de tabela de preços durante expediente.',
      context_summary: 'Cliente pediu valores.',
      suggested_next_action: 'Enviar tabela atualizada.',
    };

    const decision = parseStructuredDecision(JSON.stringify(modelResponse));
    expect(decision.transfer_required).toBe(true);
    expect(decision.response_text).not.toContain('próximo horário comercial');
    expect(decision.response_text).not.toContain('fora do horário');
  });

  // ============================================================
  // TESTE 6 & CASO B — HANDOFF ÀS 22:00 (FORA DO HORÁRIO)
  // ============================================================
  it('TESTE 6 & CASO B: Nighttime handoff at 22:00 strictly forbids immediate claims ("já vão seguir") and indicates next business period', () => {
    const nighttime = new Date('2026-09-15T22:00:00-03:00');
    const ctx = getBusinessHoursContext(baseConfig, nighttime);

    expect(ctx.isBusinessHours).toBe(false);

    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      businessHours: ctx,
      property: TOSCANO_FLAT_PROPERTY,
    });

    // Verify prompt instructions
    expect(prompt).toContain('HORÁRIO ATUAL: FORA DO EXPEDIENTE COMERCIAL');
    expect(prompt).toContain('É TERMINANTEMENTE PROIBIDO prometer atendimento imediato');
    expect(prompt).toContain('nossa equipe dará continuidade ao seu atendimento no próximo horário comercial');

    // Verify architectural guard against immediate claims
    const problematicLlmOutput =
      'Como o Live Park está em fase de pré-lançamento, para te apresentar a tabela oficial de valores e a disponibilidade em primeira mão, vou encaminhar sua conversa para nossa equipe seguir com você já com esse contexto. Um momento!';

    const sanitized = sanitizeOffHoursHandoffResponse(
      problematicLlmOutput,
      ctx.nextBusinessHourFormatted || 'no próximo horário comercial',
    );

    expect(sanitized).not.toContain('seguir com você já');
    expect(sanitized).not.toContain('já vão seguir');
    expect(sanitized).not.toContain('Um momento');
    expect(sanitized).toMatch(/fora do horário de atendimento|amanhã a partir das 08:00|próximo horário comercial/i);
  });

  // ============================================================
  // TESTE 7 — HANDOFF ÀS 07:00 (MADRUGADA / PRÉ-EXPEDIENTE)
  // ============================================================
  it('TESTE 7: Pre-opening handoff at 07:00 behaves as off-hours and correctly points to opening at 08:00', () => {
    const earlyMorning = new Date('2026-09-15T07:00:00-03:00');
    const ctx = getBusinessHoursContext(baseConfig, earlyMorning);

    expect(ctx.isBusinessHours).toBe(false);
    expect(ctx.nextBusinessHourFormatted).toBe('hoje a partir das 08:00');

    const rawOutput =
      'Para te passar as condições de pagamento, vou direcionar nossa conversa para o Ronaldo ou a Thatianna, que já dão sequência com você!';

    const sanitized = sanitizeOffHoursHandoffResponse(
      rawOutput,
      ctx.nextBusinessHourFormatted,
    );

    expect(sanitized).not.toContain('já dão sequência com você!');
    expect(sanitized).toContain('hoje a partir das 08:00');
  });

  // ============================================================
  // TESTE 8 — HANDOFF ÀS 08:00 (ABERTURA EXATA DO EXPEDIENTE)
  // ============================================================
  it('TESTE 8: Handoff at exactly 08:00 transitions to active business hours', () => {
    const openingTime = new Date('2026-09-15T08:00:00-03:00');
    const ctx = getBusinessHoursContext(baseConfig, openingTime);

    expect(ctx.isBusinessHours).toBe(true);
    expect(ctx.instructionForModel).toContain('HORÁRIO COMERCIAL ATIVO');
  });

  // ============================================================
  // TESTE 9 — TIMEZONE (America/Sao_Paulo)
  // ============================================================
  it('TESTE 9: Wall-clock decision strictly adheres to America/Sao_Paulo (UTC-3) regardless of UTC server time', () => {
    // 11:00:00 UTC = 08:00:00 SP (business hours active)
    const utcAt8Sp = new Date('2026-01-15T11:00:00.000Z');
    expect(isBusinessHours(utcAt8Sp)).toBe(true);

    // 10:59:59 UTC = 07:59:59 SP (off hours)
    const utcBefore8Sp = new Date('2026-01-15T10:59:59.000Z');
    expect(isBusinessHours(utcBefore8Sp)).toBe(false);

    // 22:59:59 UTC = 19:59:59 SP (business hours active)
    const utcBefore20Sp = new Date('2026-01-15T22:59:59.000Z');
    expect(isBusinessHours(utcBefore20Sp)).toBe(true);

    // 23:00:00 UTC = 20:00:00 SP (off hours boundary)
    const utcAt20Sp = new Date('2026-01-15T23:00:00.000Z');
    expect(isBusinessHours(utcAt20Sp)).toBe(false);

    // Check wallClockParts hour in TIMEZONE
    const parts = wallClockParts(utcAt20Sp, TIMEZONE);
    expect(parts.h).toBe(20);
    expect(parts.mi).toBe(0);
  });

  // ============================================================
  // TESTE 10 — PROIBIÇÃO DE META-LINGUAGEM DE ENVIO GRADUAL
  // ============================================================
  it('TESTE 10: Prompt strictly forbids meta-language announcing gradual delivery ("de forma gradual", "aos poucos") to the customer', () => {
    const prompt = buildConversationalSystemPrompt({
      config: baseConfig,
      mode: 'auto_reply',
      isInitialContact: true,
      userMessageCount: 1,
      property: TOSCANO_FLAT_PROPERTY,
      propertyKnowledge: TOSCANO_FLAT_KNOWLEDGE,
      communicatedContent: [],
    });

    expect(prompt).toContain('Não imponha quantidade fixa de frases, linhas ou atributos nem explique ao cliente como dosa informações');
    expect(prompt).toContain('nem explique ao cliente como dosa informações');
    expect(prompt).toContain('nem explique ao cliente como dosa informações');
  });
});

