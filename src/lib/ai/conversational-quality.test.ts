import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeConversationalTurn } from './conversation-engine';
import { buildConversationalSystemPrompt } from './prompt-builder';
import type { AiConfig } from './types';

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
  teamPresentation: 'Somos a equipe de atendimento do Ronaldo e da Thatianna.',
  globalNeverRules: 'Nunca prometer rentabilidade futura ou passar preços.',
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessDays: [1, 2, 3, 4, 5],
  offHoursInstructions: 'Acolher e avisar que a equipe dará continuidade no próximo expediente.',
  safetyMessageLimit: 8,
  responseStyleInstructions: ['Responda de forma concisa e natural.'],
};

const mockDb = {
  from: vi.fn().mockImplementation((table: string) => {
    if (table === 'properties') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'live-park-id', name: 'Live Park' },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'property_ai_contexts') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                stage: 'lancamento',
                response_style_instructions: null,
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'ai_knowledge_chunks') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            count: 0,
            error: null,
          }),
        }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    };
  }),
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
} as unknown as SupabaseClient;

describe('FASE 3 — Qualidade Conversacional e Refinamento de Comportamento', () => {
  it('limits style memories to the five highest-priority patterns in the prompt', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      styleMemories: Array.from({ length: 8 }, (_, index) => `STYLE-PATTERN-${index + 1}`),
    });

    for (let index = 1; index <= 5; index += 1) {
      expect(prompt).toContain(`STYLE-PATTERN-${index}`);
    }
    expect(prompt).not.toContain('STYLE-PATTERN-6');
    expect(prompt).not.toContain('STYLE-PATTERN-7');
    expect(prompt).not.toContain('STYLE-PATTERN-8');
  });
  // 1. Verificação das Diretrizes no System Prompt
  it('1. prompt builder includes anti-looping, optional question, and free territory autonomy rules', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'live-park-id', name: 'Live Park', stage: 'Lançamento' },
      propertyKnowledge: ['Live Park no Bessa, studios de 19 a 39 m², entrega junho de 2030.'],
    });

    expect(prompt).toContain('não repita perguntas respondidas');
    expect(prompt).toContain('Uma resposta suficiente pode terminar sem pergunta ou oferta');
    expect(prompt).toContain('Transfira quando a solicitação exigir decisão humana');
    expect(prompt).toContain('Fale de forma calorosa, atenta, simples e natural');
    expect(prompt).toContain('Responda primeiro ao pedido');
    expect(prompt).toContain('não repita perguntas respondidas');
  });

  // 2. Fronteiras Rígidas Preservadas
  it('2. rigid frontiers (builder privacy, price, visits) retain supreme authority', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'live-park-id', name: 'Live Park' },
    });

    expect(prompt).toContain('NOME DA CONSTRUTORA OU INCORPORADORA (SIGILO INSTITUCIONAL ABSOLUTO)');
    expect(prompt).toContain('REGRA DE OURO SOBRE PREÇO');
    expect(prompt).toContain('1. COMPORTAMENTO GLOBAL & REGRAS PROIBITIVAS (Máxima autoridade: define COMO agir)');
  });

  // 3. Respostas simples no território livre não devem exigir handoff
  it('3. simple information queries in free territory do not mandate transfer_required', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                response_text: 'O rooftop do Live Park conta com piscina de borda infinita e área de lazer com vista para o mar.',
                transfer_required: false,
                boundary_type: null,
                reason: 'Dúvida pontual sobre lazer respondida com sucesso.',
                context_summary: 'Cliente perguntou sobre a piscina do rooftop.',
                suggested_next_action: null,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }),
    } as unknown as Response);

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'Tem piscina no Live Park?' }],
    });

    expect(result.handoff).toBe(false);
    expect(result.decision.transfer_required).toBe(false);
    expect(result.responseText).toContain('piscina');

    global.fetch = originalFetch;
  });

  // 4. Intenção forte e fechamento acionam handoff imediato
  it('4. strong closing intent triggers handoff and commercial transfer', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                response_text: 'Excelente! Vou direcionar seu atendimento para nossa equipe dar sequência na escolha da sua unidade e na documentação.',
                transfer_required: true,
                boundary_type: 'commercial_decision',
                reason: 'Cliente declarou intenção de fechar unidade.',
                context_summary: 'Cliente quer fechar um studio no Live Park.',
                suggested_next_action: 'Assumir atendimento para formalização de proposta.',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 35, total_tokens: 155 },
      }),
    } as unknown as Response);

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'Gostei muito do Live Park e quero fechar uma unidade hoje.' },
      ],
    });

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.decision.boundary_type).toBe('commercial_decision');

    global.fetch = originalFetch;
  });

  // 5. Pergunta sobre construtora mantém sigilo absoluto
  it('5. builder inquiry preserves institutional privacy and triggers handoff', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                response_text: 'Para te passar essas informações institucionais completas com segurança, vou direcionar nossa conversa para nossa equipe de especialistas.',
                transfer_required: true,
                boundary_type: 'custom_never_rule',
                reason: 'Pergunta sobre construtora/incorporadora.',
                context_summary: 'Cliente perguntou qual a construtora do Live Park.',
                suggested_next_action: 'Assumir conversa e dar sequência ao atendimento.',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 150, completion_tokens: 35, total_tokens: 185 },
      }),
    } as unknown as Response);

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'Qual é a construtora do Live Park?' }],
    });

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.responseText).not.toContain('LCA');

    global.fetch = originalFetch;
  });

  // 6. Consistência entre modos Draft e Auto-Reply
  it('6. draft and auto-reply produce consistent structured output', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                response_text: 'O Live Park conta com studios de 19 a 39 m² no Bessa.',
                transfer_required: false,
                boundary_type: null,
                reason: 'Informações autorizadas de metragem.',
                context_summary: 'Dúvida sobre metragem do Live Park.',
                suggested_next_action: null,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      }),
    } as unknown as Response);

    const draftResult = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'Qual a metragem?' }],
      mode: 'draft',
    });

    const autoReplyResult = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'Qual a metragem?' }],
      mode: 'auto_reply',
    });

    expect(draftResult.decision.response_text).toBe(autoReplyResult.decision.response_text);
    expect(draftResult.decision.transfer_required).toBe(autoReplyResult.decision.transfer_required);

    global.fetch = originalFetch;
  });

  it('7. prompt builder enforces anti-bobinha, anti-bajulacao, and conciseness rules', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      isInitialContact: true,
      property: { id: 'mahal-id', name: 'Mahal Resort' },
      styleMemories: [
        'Usa tom promocional com emoji',
        'Fala com clareza sobre o bairro',
      ],
      globalMemories: [
        'Atendente inclui emoji na abertura',
        'Imóveis na praia têm boa liquidez',
      ],
    });

    // Enforces mature, non-sycophantic tone
    expect(prompt).toContain('ANTI-BOBINHA E ANTI-BAJULAÇÃO');
    expect(prompt).toContain('CONCISÃO OBRIGATÓRIA E ANTI-TEXTÃO');
    expect(prompt).toContain('1 a 3 frases concisas');
    expect(prompt).not.toContain('Que bom falar com você!');
    expect(prompt).not.toContain('😊');

    // Filters out poisoned memories mentioning emoji or promocional
    expect(prompt).not.toContain('Usa tom promocional com emoji');
    expect(prompt).not.toContain('Atendente inclui emoji na abertura');
    expect(prompt).toContain('Fala com clareza sobre o bairro');
    expect(prompt).toContain('Imóveis na praia têm boa liquidez');
  });

  it('8. prompt builder incorporates malemolencia, measured validation, flexible commercial direction, and lead preservation', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'mahal-id', name: 'Mahal Resort' },
    });

    // Malemolência & spoken Brazilian language
    expect(prompt).toContain('MALEMOLÊNCIA E LINGUAGEM FALADA');
    expect(prompt).toContain('O Mahal funciona muito como um resort e já tem uma estrutura pronta pra quem quer alugar por temporada');
    expect(prompt).toContain('Fala de igual pra igual, com calma e naturalidade brasileira');

    // Measured validation without sycophancy or degradê
    expect(prompt).toContain('ACOLHIMENTO E VALIDAÇÃO DOSADA (SEM PUXA-SAQUISMO OU "DEGRADÊ")');
    expect(prompt).toContain('Boa escolha de região');
    expect(prompt).toContain('NUNCA crie um "degradê" de elogios');

    // Flexible commercial direction (~80% questions, ~20% confident affirmations/handoff)
    expect(prompt).toContain('DIRECIONAMENTO COMERCIAL FLEXÍVEL');
    expect(prompt).toContain('aproximadamente 80% das respostas');
    expect(prompt).toContain('Não torne a pergunta uma obrigação mecânica de 100%');

    // Lead preservation
    expect(prompt).toContain('NUNCA PERCA UM LEAD');
    expect(prompt).toContain('SEMPRE acione transfer_required = true');
  });
});
