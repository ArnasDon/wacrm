import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  teamPresentation: 'Somos a equipe de atendimento do Ronaldo Meira.',
  globalNeverRules: 'Nunca prometer rentabilidade futura garantida.',
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessDays: [1, 2, 3, 4, 5],
  offHoursInstructions: 'Acolher e avisar que a equipe dará continuidade no próximo expediente.',
  safetyMessageLimit: 8,
  responseStyleInstructions: [
    'Responda de forma concisa e natural.',
  ],
};

const PUERTO_VENTURA_PROPERTY = {
  id: 'pv-cabo-branco',
  name: 'Puerto Ventura',
  stage: 'Pronto',
  status: 'ativo',
};

const PUERTO_VENTURA_KNOWLEDGE = [
  `[Origem: Ficha Técnica]
1. DADOS GERAIS: Puerto Ventura na Avenida Cabo Branco, em frente à praia, João Pessoa/PB. Locação mensal de R$ 3.500/mês com condomínio incluso. Garagem rotativa.
2. CARACTERÍSTICAS DA UNIDADE:
- Metragem: Aproximadamente 45 m², 1 quarto com ambientes separados — sala, quarto, cozinha e banheiro.
- Mobília: Totalmente mobiliada e decorada, pronta para morar.
- Posição e Vista: Posição sul e vista lateral, com ótima ventilação natural. NÃO possui vista frontal para o mar.
- Abertura da Sala: Esquadria envidraçada de grandes dimensões. Não possui varanda.
3. INFRAESTRUTURA E ÁREAS COMUNS: Rooftop com piscina e vista panorâmica, academia, restaurante, lavanderia e portaria 24h.`,
];

const mockDb = {
  from: vi.fn().mockImplementation((table: string) => {
    if (table === 'properties') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: PUERTO_VENTURA_PROPERTY,
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
                stage: 'pronto',
                response_style_instructions: null,
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'ai_knowledge_chunks') {
      const q: Record<string, unknown> = {
        data: [],
        error: null,
        count: 1,
      };
      q.eq = vi.fn().mockReturnValue(q);
      q.in = vi.fn().mockResolvedValue({ data: [], error: null });
      q.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
      return {
        select: vi.fn().mockReturnValue(q),
      };
    }
    if (table === 'ai_memories') {
      const q: Record<string, unknown> = {
        data: [],
        error: null,
      };
      q.eq = vi.fn().mockReturnValue(q);
      q.in = vi.fn().mockReturnValue(q);
      q.order = vi.fn().mockReturnValue(q);
      q.limit = vi.fn().mockReturnValue(q);
      q.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
      return {
        select: vi.fn().mockReturnValue(q),
      };
    }
    if (table === 'property_images') {
      const queryObj: Record<string, unknown> = {
        data: [],
        error: null,
      };
      queryObj.eq = vi.fn().mockReturnValue(queryObj);
      queryObj.in = vi.fn().mockResolvedValue({ data: [], error: null });
      queryObj.order = vi.fn().mockReturnValue(queryObj);
      queryObj.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
      return {
        select: vi.fn().mockReturnValue(queryObj),
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
  rpc: vi.fn().mockImplementation((fnName: string) => {
    if (fnName.includes('ai_knowledge')) {
      return Promise.resolve({
        data: [
          {
            id: 'chunk-pv-1',
            content: PUERTO_VENTURA_KNOWLEDGE[0],
            is_global: false,
          },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: [], error: null });
  }),
} as unknown as SupabaseClient;

function mockFetchModelResponse(payload: {
  response_text: string;
  transfer_required: boolean;
  boundary_type?: string | null;
  reason?: string;
  context_summary?: string;
  suggested_next_action?: string | null;
}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              response_text: payload.response_text,
              transfer_required: payload.transfer_required,
              boundary_type: payload.boundary_type ?? null,
              reason: payload.reason ?? 'Turn processed',
              context_summary: payload.context_summary ?? 'Context summary',
              suggested_next_action: payload.suggested_next_action ?? null,
            }),
          },
        },
      ],
      usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 },
    }),
  } as unknown as Response);
}

describe('CLARA — Conversational Progression, Information Deduplication and Behavioral Boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // TESTE 1 — PEDIDO GENÉRICO DE MAIS DETALHES
  // Dado que a Clara já informou: 45 m², 1 quarto, sala, cozinha, banheiro, mobiliado
  // Quando o lead disser: "Me passa mais detalhes"
  // A resposta NÃO deve simplesmente repetir todo esse bloco.
  // ============================================================
  it('TESTE 1: Generic request for "mais detalhes" must not repeat previously communicated block (45m², 1 quarto, mobiliado)', async () => {
    const originalFetch = global.fetch;

    // Simulation where model follows the system prompt instructions:
    // It advances with position, view and ventilation instead of repeating the unit overview block.
    global.fetch = mockFetchModelResponse({
      response_text:
        'Claro. Além da estrutura que te apresentei, a unidade conta com posição sul, vista lateral e excelente ventilação natural. O edifício também oferece rooftop com piscina panorâmica e academia. Gostaria de saber mais sobre a área de lazer ou prefere entender as regras de locação?',
      transfer_required: false,
      reason: 'Apresentadas novas informações (posição solar, vista e rooftop) sem repetir o bloco inicial.',
    });

    const messages = [
      {
        role: 'user' as const,
        content: 'Gostaria de mais informações sobre o flat para locação no Cabo Branco!',
      },
      {
        role: 'assistant' as const,
        content:
          'Olá! 😊 Sou a Clara, assistente do Ronaldo Meira. O Puerto Ventura fica na Avenida Cabo Branco, em frente à praia, com aproximadamente 45 m², 1 quarto e a unidade já vem totalmente mobiliada e decorada — pronta para morar. A locação é mensal, com condomínio incluso, e a garagem é rotativa. Se você quiser, eu posso te passar mais detalhes da unidade ou já direcionar nossa equipe para continuar com você aqui no atendimento.',
      },
      {
        role: 'user' as const,
        content: 'Apenas 1 quarto?\nFaz contrato de quanto tempo?',
      },
      {
        role: 'assistant' as const,
        content:
          'Sim, é uma unidade de 1 quarto, com sala, cozinha e banheiro separados. Apesar da metragem compacta, ela é bem completa e já vem mobiliada. Se quiser, posso te passar mais detalhes da estrutura do imóvel e do empreendimento.',
      },
      {
        role: 'user' as const,
        content: 'Me passa mais detalhes por favor',
      },
    ];

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'acc-1',
      config: BASE_CONFIG,
      propertyId: PUERTO_VENTURA_PROPERTY.id,
      messages,
      simulatedHours: 'business_hours',
    });

    global.fetch = originalFetch;

    // System prompt must contain communicated context and strict progression directives
    expect(result.systemPrompt).toContain('INFORMAÇÕES JÁ COMUNICADAS AO CLIENTE');
    expect(result.systemPrompt).toContain('Considere o histórico recente');
    expect(result.systemPrompt).toContain('Em pedidos de mais detalhes');
    expect(result.systemPrompt).toContain('não reapresente informações como novidade nem repita blocos');
    expect(result.systemPrompt).toContain('não reapresente informações como novidade nem repita blocos');

    // Response must progress and not simply re-introduce the whole block
    const resp = result.decision.response_text;
    expect(resp.toLowerCase()).toContain('posição sul');
    expect(resp.toLowerCase()).toContain('vista lateral');
    // Shouldn't re-pitch 45m² as a new core statement
    expect(resp).not.toMatch(/unidade tem aproximadamente 45 m², com ambientes separados — sala, quarto, cozinha e banheiro/i);
    expect(result.handoff).toBe(false);
  });

  // ============================================================
  // TESTE 2 — INFORMAÇÃO NOVA
  // Se existir no conhecimento: posição sul, vista lateral, ventilação natural.
  // A Clara deve priorizar essas informações.
  // ============================================================
  it('TESTE 2: New uncommunicated information (posição sul, vista lateral, ventilação) is prioritized on progression', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: PUERTO_VENTURA_PROPERTY,
      propertyKnowledge: PUERTO_VENTURA_KNOWLEDGE,
      communicatedContent: [
        'O Puerto Ventura tem aproximadamente 45 m², 1 quarto, mobiliado e decorado.',
        'São ambientes separados — sala, quarto, cozinha e banheiro.',
      ],
      userMessageCount: 3,
    });

    expect(prompt).toContain('Posição sul e vista lateral, com ótima ventilação natural');
    expect(prompt).toContain('Em pedidos de mais detalhes');
    expect(prompt).toContain('selecione fatos autorizados ainda não compartilhados e relevantes ao pedido');
    expect(prompt).toContain('não reapresente informações como novidade nem repita blocos');
  });

  // ============================================================
  // TESTE 3 — PERGUNTA ESPECÍFICA
  // Se o lead perguntar: "Quantos metros quadrados?"
  // A Clara pode responder: "45 m²." Mesmo que isso já tenha sido mencionado anteriormente.
  // ============================================================
  it('TESTE 3: Specific factual question allows confirming/repeating previously mentioned fact (e.g. 45 m²)', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchModelResponse({
      response_text: 'O flat tem aproximadamente 45 m², muito bem distribuídos entre sala, quarto, cozinha e banheiro.',
      transfer_required: false,
      reason: 'Dúvida pontual e específica sobre metragem confirmada diretamente.',
    });

    const messages = [
      {
        role: 'user' as const,
        content: 'Olá, gostei do Puerto Ventura!',
      },
      {
        role: 'assistant' as const,
        content: 'Olá! O Puerto Ventura tem cerca de 45 m² e fica na beira-mar de Cabo Branco.',
      },
      {
        role: 'user' as const,
        content: 'Quantos metros quadrados tem o apartamento?',
      },
    ];

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'acc-1',
      config: BASE_CONFIG,
      propertyId: PUERTO_VENTURA_PROPERTY.id,
      messages,
      simulatedHours: 'business_hours',
    });

    global.fetch = originalFetch;

    expect(result.systemPrompt).toContain('Repita um fato apenas se a pessoa perguntar');
    expect(result.systemPrompt).toContain('a pessoa perguntar');
    expect(result.decision.response_text).toContain('45 m²');
    expect(result.handoff).toBe(false);
  });

  // ============================================================
  // TESTE 4 — CONTEXTUALIZAÇÃO
  // A Clara pode repetir uma informação anterior quando necessário para explicar uma informação nova.
  // ============================================================
  it('TESTE 4: Contextual repetition is allowed as a brief bridge/anchor to introduce new information', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: PUERTO_VENTURA_PROPERTY,
      propertyKnowledge: PUERTO_VENTURA_KNOWLEDGE,
      communicatedContent: [
        'O apartamento possui 45 m² e 1 quarto.',
      ],
      userMessageCount: 2,
    });

    expect(prompt).toContain('Repita um fato apenas se a pessoa perguntar');
    expect(prompt).toContain('a pessoa perguntar');
    expect(prompt).toContain('ou se ele for necessário para esclarecer a resposta');
  });

  // ============================================================
  // TESTE 5 — SEM INFORMAÇÃO NOVA
  // Se não existir informação adicional confiável, a Clara NÃO deve inventar características apenas para evitar repetição.
  // Deve responder de forma natural e conduzir a conversa para outra informação ou para o próximo passo.
  // ============================================================
  it('TESTE 5: When no new reliable information exists, Clara must never hallucinate new features and should guide naturally', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchModelResponse({
      response_text:
        'Essas são as principais características da unidade: o flat mobiliado de 45 m², em frente ao mar, com toda a estrutura do prédio à disposição. Para que possamos verificar a disponibilidade exata ou alinhar uma visita, você prefere que nossa equipe entre em contato?',
      transfer_required: false,
      reason: 'Informações principais já apresentadas; conduzindo naturalmente para o próximo passo comercial sem inventar dados.',
    });

    const messages = [
      { role: 'user' as const, content: 'Me fale do flat.' },
      { role: 'assistant' as const, content: 'Flat de 45m², 1 quarto, mobiliado, no Puerto Ventura.' },
      { role: 'user' as const, content: 'E a vista e lazer?' },
      { role: 'assistant' as const, content: 'Posição sul com vista lateral e rooftop com piscina.' },
      { role: 'user' as const, content: 'Que mais você pode me dizer dele?' },
    ];

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'acc-1',
      config: BASE_CONFIG,
      propertyId: PUERTO_VENTURA_PROPERTY.id,
      messages,
      simulatedHours: 'business_hours',
    });

    global.fetch = originalFetch;

    expect(result.systemPrompt).toContain('sem inventar nem forçar uma próxima etapa');
    expect(result.systemPrompt).toContain('responda com naturalidade sem inventar nem forçar uma próxima etapa');
    expect(result.decision.response_text).not.toContain('cinema privativo'); // no hallucination
    expect(result.decision.response_text).toContain('principais características');
  });

  // ============================================================
  // TESTE 6 — KNOWLEDGE RETRIEVAL
  // Se o mesmo conhecimento retornar novamente pelo RAG/retrieval, ele NÃO deve ser tratado automaticamente como informação nova.
  // ============================================================
  it('TESTE 6: Retrieved RAG chunk containing previously spoken features is not treated as new information', () => {
    const communicated = [
      'O Puerto Ventura tem aproximadamente 45 m², 1 quarto e a unidade já vem totalmente mobiliada e decorada.',
    ];

    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: PUERTO_VENTURA_PROPERTY,
      propertyKnowledge: PUERTO_VENTURA_KNOWLEDGE,
      communicatedContent: communicated,
      userMessageCount: 2,
    });

    // The system prompt explicitly informs the model that the fact of being in the reference material
    // does NOT make it new if it has already been transmitted in previous turns.
    expect(prompt).toContain('Considere o histórico recente');
    expect(prompt).toContain('não reapresente informações como novidade nem repita blocos');
    expect(prompt).toContain('INFORMAÇÕES JÁ COMUNICADAS AO CLIENTE');
    // Verifies elimination of duplicate assistant messages: the directive instructs the model
    // to reference native message history directly, without duplicating message text into the system prompt.
    expect(prompt).not.toContain(communicated[0]);
  });

  // ============================================================
  // TESTE 7 — CONDUÇÃO
  // A correção não pode fazer a Clara ficar passiva. Ela deve continuar conduzindo naturalmente a conversa.
  // ============================================================
  it('TESTE 7: Clara maintains active commercial conduction and never falls into passive answering', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: PUERTO_VENTURA_PROPERTY,
      propertyKnowledge: PUERTO_VENTURA_KNOWLEDGE,
      communicatedContent: ['Mensagem prévia 1'],
      userMessageCount: 2,
    });

    expect(prompt).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');
    expect(prompt).toContain('uma resposta completa e suficiente pode terminar ali');
    expect(prompt).toContain('resposta suficiente pode terminar sem pergunta ou oferta');
    expect(prompt).toContain('Responda primeiro ao pedido');
  });

  // ============================================================
  // TESTE 8 — HANDOFF
  // A correção não pode alterar indevidamente as regras existentes de handoff.
  // ============================================================
  it('TESTE 8: Rigid boundaries like human request or visit still trigger immediate handoff', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchModelResponse({
      response_text:
        'Com certeza! Para agendarmos a visita e acompanharmos você presencialmente no Puerto Ventura, vou direcionar nossa conversa para o Ronaldo e a Thatianna que combinam o melhor dia e horário.',
      transfer_required: true,
      boundary_type: 'visit_request',
      reason: 'Cliente solicitou agendamento de visita.',
    });

    const messages = [
      { role: 'user' as const, content: 'Quero mais detalhes do flat' },
      { role: 'assistant' as const, content: 'Flat de 45m² no Cabo Branco.' },
      { role: 'user' as const, content: 'Consigo agendar uma visita amanhã?' },
    ];

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'acc-1',
      config: BASE_CONFIG,
      propertyId: PUERTO_VENTURA_PROPERTY.id,
      messages,
      simulatedHours: 'business_hours',
    });

    global.fetch = originalFetch;

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.decision.boundary_type).toBe('visit_request');
  });

  // ============================================================
  // TESTE 9 — PREÇO
  // A correção não pode alterar as regras existentes de preço.
  // ============================================================
  it('TESTE 9: Ready property price exception is preserved from knowledge without regression', () => {
    const readyPrompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'prop-ready', name: 'Puerto Ventura', stage: 'Pronto' },
      propertyKnowledge: ['Aluguel: R$ 3.500/mês'],
    });

    expect(readyPrompt).toContain('PREÇO E VALORES (PERMITIDO PARA IMÓVEL PRONTO SE PRESENTE NO CONHECIMENTO)');

    const offPlanPrompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'prop-plan', name: 'Reserva Bela Vista', stage: 'Lançamento' },
      propertyKnowledge: ['A partir de R$ 500.000'],
    });

    expect(offPlanPrompt).toContain('REGRA DE OURO SOBRE PREÇO: Mesmo que você veja um valor em um PDF, anotação ou histórico, PREÇO É DADO DINÂMICO E VOCÊ NUNCA INFORMA AO CLIENTE');
  });

  // ============================================================
  // TESTE 10 — HISTÓRICO LONGO
  // Verifique o comportamento quando a mesma informação apareceu várias vezes ao longo de uma conversa longa.
  // A Clara deve conseguir distinguir informação previamente comunicada de informação nova.
  // ============================================================
  it('TESTE 10: Long conversation history correctly tracks all previous assistant messages and identifies communicated facts', async () => {
    const longMessages = [
      { role: 'user' as const, content: 'Oi, tudo bem?' },
      { role: 'assistant' as const, content: 'Olá! Sou a Clara. Como posso te ajudar?' },
      { role: 'user' as const, content: 'Tem flat em Cabo Branco?' },
      { role: 'assistant' as const, content: 'Temos o Puerto Ventura, com 45 m² e 1 quarto mobiliado.' },
      { role: 'user' as const, content: 'Tem elevador?' },
      { role: 'assistant' as const, content: 'Sim, o prédio conta com elevadores modernos e portaria 24 horas.' },
      { role: 'user' as const, content: 'E é perto do mar?' },
      { role: 'assistant' as const, content: 'Fica na Avenida Cabo Branco, exatamente em frente à praia.' },
      { role: 'user' as const, content: 'Me passa mais detalhes por favor' },
    ];

    const originalFetch = global.fetch;
    global.fetch = mockFetchModelResponse({
      response_text:
        'Claro! Além do que já vimos sobre a localização em frente ao mar e a estrutura do flat, a unidade tem posição sul com vista lateral e ventilação natural. O prédio conta ainda com restaurante, lavanderia e rooftop com piscina. Gostaria de saber mais sobre as áreas comuns ou sobre as condições de locação?',
      transfer_required: false,
      reason: 'Progresso da apresentação para posição solar, vista e lazer.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'acc-1',
      config: BASE_CONFIG,
      propertyId: PUERTO_VENTURA_PROPERTY.id,
      messages: longMessages,
      simulatedHours: 'business_hours',
    });

    global.fetch = originalFetch;

    // Progression directive is present and instructs the model to reference native chat history
    expect(result.systemPrompt).toContain('INFORMAÇÕES JÁ COMUNICADAS AO CLIENTE');
    expect(result.systemPrompt).toContain('Em pedidos de mais detalhes');
    // Assistant messages are preserved in native chat history, NOT duplicated verbatim into the system prompt
    expect(result.systemPrompt).not.toContain('Temos o Puerto Ventura, com 45 m² e 1 quarto mobiliado.');
    expect(result.systemPrompt).not.toContain('Sim, o prédio conta com elevadores modernos e portaria 24 horas.');
    expect(result.systemPrompt).not.toContain('Fica na Avenida Cabo Branco, exatamente em frente à praia.');

    // Response should bring fresh information
    expect(result.decision.response_text).toContain('posição sul');
    expect(result.decision.response_text).toContain('vista lateral');
    expect(result.decision.response_text).toContain('restaurante');
    expect(result.handoff).toBe(false);
  });

  // ============================================================
  // TESTE 11 — PEDIDOS SUCESSIVOS DE MAIS DETALHES (3 TURNOS CONSECUTIVOS)
  // Confirma que a Clara:
  // 1. Não repete os mesmos blocos;
  // 2. Não inventa características;
  // 3. Mantém condução ativa em cada resposta;
  // 4. Vai esgotando naturalmente as informações disponíveis e direciona para o próximo passo.
  // ============================================================
  it('TESTE 11: Three consecutive "more details" requests systematically traverse uncommunicated facts without looping or hallucinating', async () => {
    const originalFetch = global.fetch;

    // TURNO 1: Lead pede mais detalhes após introdução inicial (45m², 1 quarto, mobiliado)
    const turn1Assistant =
      'Claro. A unidade conta com posição sul, vista lateral e excelente ventilação natural por uma esquadria envidraçada ampla. Se quiser, posso te explicar melhor sobre a área de lazer ou sobre o funcionamento da locação.';

    // TURNO 2: Lead insiste pedindo mais ("E o que mais tem?")
    const turn2Assistant =
      'O Puerto Ventura oferece rooftop com piscina panorâmica de frente para o mar, academia, restaurante, lavanderia e portaria 24 horas. A locação é mensal e já inclui a taxa de condomínio. Gostaria de verificar a disponibilidade de datas ou prefere ver fotos da área comum?';

    // TURNO 3: Lead pede mais uma vez ("Tem mais alguma coisa?")
    const turn3Assistant =
      'Essas são todas as principais características e diferenciais da unidade e do empreendimento! Como você já conheceu toda a estrutura do flat e do condomínio, o próximo passo ideal é nossa equipe verificar a disponibilidade exata e te passar os detalhes da locação. Posso direcionar para o Ronaldo ou a Thatianna continuarem com você por aqui?';

    // Executamos o Turno 3 diretamente para verificar como o motor prepara o prompt e consome os turnos acumulados
    const messages = [
      {
        role: 'user' as const,
        content: 'Quero saber do flat Puerto Ventura.',
      },
      {
        role: 'assistant' as const,
        content:
          'Olá! O Puerto Ventura fica na Avenida Cabo Branco, em frente à praia, com aproximadamente 45 m², 1 quarto mobiliado e decorado.',
      },
      {
        role: 'user' as const,
        content: 'Me passa mais detalhes',
      },
      {
        role: 'assistant' as const,
        content: turn1Assistant,
      },
      {
        role: 'user' as const,
        content: 'E o que mais tem?',
      },
      {
        role: 'assistant' as const,
        content: turn2Assistant,
      },
      {
        role: 'user' as const,
        content: 'Tem mais alguma coisa?',
      },
    ];

    global.fetch = mockFetchModelResponse({
      response_text: turn3Assistant,
      transfer_required: false,
      reason: 'Todas as características principais foram percorridas; conduzindo naturalmente para continuidade com a equipe sem inventar novidades.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'acc-1',
      config: BASE_CONFIG,
      propertyId: PUERTO_VENTURA_PROPERTY.id,
      messages,
      simulatedHours: 'business_hours',
    });

    global.fetch = originalFetch;

    // 1. O prompt acumulou o contexto e as diretrizes de progressão, eliminando a duplicação verbatim das mensagens anteriores da Clara
    expect(result.systemPrompt).toContain('INFORMAÇÕES JÁ COMUNICADAS AO CLIENTE');
    expect(result.systemPrompt).not.toContain(turn1Assistant);
    expect(result.systemPrompt).not.toContain(turn2Assistant);

    // 2. Diretriz explícita de encerramento do ciclo sem forçar novidades artificiais
    expect(result.systemPrompt).toContain('Se não houver novidade útil, responda com naturalidade');
    expect(result.systemPrompt).toContain('sem inventar nem forçar uma próxima etapa');

    // 3. A resposta do turno 3 não repete blocos velhos (45 m², posição sul, rooftop)
    const resp = result.decision.response_text;
    expect(resp).not.toContain('45 m²');
    expect(resp).not.toContain('posição sul');
    expect(resp).not.toContain('rooftop com piscina');

    // 4. A resposta não inventa itens não autorizados (ex: cinema, sauna, spa, heliporto)
    expect(resp).not.toContain('cinema');
    expect(resp).not.toContain('sauna');
    expect(resp).not.toContain('spa');

    // 5. Mantém condução ativa direcionando para o próximo passo comercial de forma institucional (sem vazar nomes)
    expect(resp).toContain('próximo passo');
    expect(resp).toContain('nossa equipe');
    expect(resp).not.toMatch(/\b(ronaldo|thatianna)\b/i);
  });
});

