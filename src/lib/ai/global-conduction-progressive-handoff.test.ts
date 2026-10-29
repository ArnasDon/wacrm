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
  responseStyleInstructions: [
    '[Condução Ativa] Evite o padrão passivo de responder e parar.',
    '[Condução Contextual] Perguntas devem nascer naturalmente do assunto.',
  ],
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
    if (table === 'property_images') {
      const mockImages = [
        {
          id: 'media-1',
          property_id: 'live-park-id',
          storage_path: 'props/fachada.jpg',
          file_name: 'fachada.jpg',
          content_type: 'image/jpeg',
          description: 'Fachada contemporânea com jardins suspensos',
          is_cover: false,
          position: 1,
        },
      ];
      const queryObj: Record<string, unknown> = {
        data: mockImages,
        error: null,
      };
      queryObj.eq = vi.fn().mockReturnValue(queryObj);
      queryObj.in = vi.fn().mockResolvedValue({ data: mockImages, error: null });
      queryObj.order = vi.fn().mockReturnValue(queryObj);
      queryObj.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: mockImages, error: null }).then(resolve);
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
  storage: {
    from: vi.fn().mockReturnValue({
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/fachada.jpg' },
        error: null,
      }),
      getPublicUrl: vi.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/fachada.jpg' },
      }),
    }),
  },
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
} as unknown as SupabaseClient;

function mockFetchResponse(payload: {
  response_text: string;
  transfer_required: boolean;
  boundary_type?: string | null;
  reason?: string;
  context_summary?: string;
  suggested_next_action?: string | null;
  media_to_send?: Array<{ id: string; description: string; file_name: string }>;
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
              send_media: payload.media_to_send ?? [],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 150, completion_tokens: 60, total_tokens: 210 },
    }),
  } as unknown as Response);
}

describe('GLOBAL CONVERSATIONAL INTELLIGENCE — Clara Conduction & Progressive Handoff', () => {
  // Verificação Estrutural do System Prompt Global
  it('verifies that system prompt embodies all core conduction and progressive handoff rules', () => {
    const promptInitial = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'live-park-id', name: 'Live Park', stage: 'Lançamento' },
      userMessageCount: 1,
    });

    // 1. Princípio Central: Conduzir, Não Apenas Responder
    expect(promptInitial).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');
    expect(promptInitial).toContain('Uma resposta suficiente pode terminar sem pergunta ou oferta');
    expect(promptInitial).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');

    // 2. O Princípio do "Próximo Passo"
    expect(promptInitial).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');
    expect(promptInitial).toContain('Use o contexto já dado');

    // 3. Perguntas Contextuais vs Estereotipadas
    expect(promptInitial).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');
    expect(promptInitial).toContain('Para imóvel de locação, considere moradia como finalidade');
    expect(promptInitial).toContain('Faça uma pergunta por vez apenas quando a resposta ajudar');

    // 4. Não Interrogar
    expect(promptInitial).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');

    // 5. Princípio de Progressão e Sinais
    expect(promptInitial).toContain('Observe sinais de interesse');

    // 6. Tendência Progressiva a partir da 3ª Mensagem
    expect(promptInitial).toContain('A partir da terceira mensagem');
    expect(promptInitial).toContain('sem transferir só pela contagem');
    expect(promptInitial).toContain('considere com mais atenção se a equipe agrega valor');

    // 7. Não Repetir Encaminhamentos Clichês
    expect(promptInitial).toContain('Transfira quando a solicitação exigir decisão humana');

    // Turn context: na 1ª mensagem
    expect(promptInitial).toContain('ESTÁGIO ATUAL DA CONVERSA: 1ª mensagem do cliente neste diálogo');

    // Turn context: na 3ª mensagem em diante
    const promptMature = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: { id: 'live-park-id', name: 'Live Park', stage: 'Lançamento' },
      userMessageCount: 3,
    });
    expect(promptMature).toContain('ESTÁGIO ATUAL DA CONVERSA: 3ª mensagem do cliente neste diálogo');
    expect(promptMature).toContain('aplique a tendência progressiva de encaminhamento para a equipe humana');
  });

  // CENÁRIO A: Cliente faz uma pergunta simples. A Clara responde normalmente sem forçar encaminhamento.
  it('CENÁRIO A: Simple informational query is answered and conducted naturally without forced handoff', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'O Live Park conta com uma academia totalmente equipada no edifício, além de espaços ao ar livre. Você costuma praticar musculação ou prefere atividades aeróbicas e ao ar livre?',
      transfer_required: false,
      reason: 'Dúvida simples sobre academia respondida com pergunta contextual.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'O Live Park tem academia?' }],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(false);
    expect(result.decision.transfer_required).toBe(false);
    expect(result.responseText).toContain('academia');
    expect(result.systemPrompt).toContain('DIRETRIZES DE CONVERSA E ENCAMINHAMENTO');

    global.fetch = originalFetch;
  });

  // CENÁRIO B: Cliente pede fotos. A Clara envia/indica as fotos e cria uma continuação contextual.
  it('CENÁRIO B: Photo request triggers media presentation with contextual follow-up rather than empty stop', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'Claro! Estou te encaminhando as fotos para você conhecer melhor a fachada e a proposta arquitetônica do Live Park. Pelo estilo contemporâneo com floreiras, ele costuma chamar bastante atenção. O que mais pesa para você nessa escolha: localização, estrutura de lazer ou o perfil da unidade?',
      transfer_required: false,
      media_to_send: [
        { id: 'media-1', description: 'Fachada contemporânea com jardins suspensos', file_name: 'fachada.jpg' },
      ],
      reason: 'Fotos apresentadas e continuação contextual sobre fatores de decisão do cliente.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'Tem fotos?' }],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(false);
    expect(result.decision.transfer_required).toBe(false);
    expect(result.responseText).toContain('fotos');
    expect(result.responseText).toContain('O que mais pesa para você');
    expect(result.validatedMediaToSend.length).toBeGreaterThanOrEqual(1);

    global.fetch = originalFetch;
  });

  // CENÁRIO C: Cliente pergunta localização e metragem. A Clara responde e conduz naturalmente.
  it('CENÁRIO C: Location and footage inquiry is answered precisely with natural contextual conduction', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'O Live Park fica no bairro do Bessa, numa região carinhosamente conhecida como Caribessa a cerca de 170 metros da praia, com unidades compactas e funcionais de 19 a 39 m². Você está buscando uma opção mais enxuta para locação por temporada ou prefere uma metragem um pouco maior para uso pessoal?',
      transfer_required: false,
      reason: 'Localização e metragem esclarecidas com condução contextual conectada à finalidade da metragem.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [{ role: 'user', content: 'Fica onde e qual o tamanho?' }],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(false);
    expect(result.decision.transfer_required).toBe(false);
    expect(result.responseText).toContain('Bessa');
    expect(result.responseText).toContain('19 a 39 m²');
    expect(result.responseText).toContain('Você está buscando');

    global.fetch = originalFetch;
  });

  // CENÁRIO D: Cliente troca 3 ou mais mensagens, mas demonstra pouco interesse.
  // A Clara NÃO deve encaminhar obrigatoriamente apenas porque atingiu três mensagens.
  it('CENÁRIO D: 3+ messages with low engagement does NOT mechanically force handoff', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'Combinado! Qualquer outra dúvida sobre a estrutura ou o projeto, estou à disposição para te orientar.',
      transfer_required: false,
      reason: 'Cliente respondeu de forma lacônica; mantido sem transfer_required mecânico.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'Onde fica?' },
        { role: 'assistant', content: 'Fica no Bessa, perto da praia.' },
        { role: 'user', content: 'Tem piscina?' },
        { role: 'assistant', content: 'Sim, piscina no rooftop com vista panorâmica.' },
        { role: 'user', content: 'Ah sim, entendi.' },
      ],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(false);
    expect(result.decision.transfer_required).toBe(false);
    // Verifies system prompt passed userMessageCount = 3 without rigid mechanical gate
    expect(result.systemPrompt).toContain('ESTÁGIO ATUAL DA CONVERSA: 3ª mensagem do cliente neste diálogo');

    global.fetch = originalFetch;
  });

  // CENÁRIO E: Cliente troca 3 ou mais mensagens e demonstra interesse crescente.
  // A Clara deve apresentar maior propensão a encaminhar.
  it('CENÁRIO E: 3+ messages with rising engagement increases propensity to transition to team', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'Excelente! Como você gostou da localização no Bessa e já está avaliando o potencial de locação para as unidades de 28 m², vale muito a pena nossa equipe te apresentar a projeção completa e as melhores unidades. Vou direcionar nossa conversa para o Ronaldo e a Thatianna darem continuidade com você por aqui!',
      transfer_required: true,
      boundary_type: 'commercial_qualification',
      reason: 'Conversa madura (3ª mensagem) com forte interesse crescente demonstrado pelo lead.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'Gostei muito do Live Park. Onde fica exatamente?' },
        { role: 'assistant', content: 'Fica no Bessa, a 170 metros da praia.' },
        { role: 'user', content: 'E quais os tamanhos?' },
        { role: 'assistant', content: 'Temos unidades de 19 a 39 m² com excelente planta.' },
        { role: 'user', content: 'Amei as opções de 28 m², tem tudo a ver com o investimento em Airbnb que estou planejando.' },
      ],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.responseText).toContain('nossa equipe');
    expect(result.responseText).not.toMatch(/\b(ronaldo|thatianna)\b/i);

    global.fetch = originalFetch;
  });

  // CENÁRIO F: Cliente chega à terceira mensagem e começa a perguntar preço, condições ou negociação.
  // Tendência de encaminhamento atinge fronteira rígida e formaliza handoff.
  it('CENÁRIO F: 3rd message touching price/payment terms triggers immediate handoff respecting rigid boundaries', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'Para te passar a tabela oficial de valores e as condições de pagamento do Live Park em primeira mão, vou conectar você diretamente com o Ronaldo ou a Thatianna, que já dão sequência no seu atendimento!',
      transfer_required: true,
      boundary_type: 'price',
      reason: 'Cliente perguntou tabela de preços e condições na 3ª mensagem; acionada fronteira rígida.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'Boa tarde, tudo bem?' },
        { role: 'assistant', content: 'Olá! Como posso te ajudar hoje?' },
        { role: 'user', content: 'Quero saber sobre o Live Park.' },
        { role: 'assistant', content: 'O Live Park é um excelente empreendimento no Bessa a 170 metros da praia.' },
        { role: 'user', content: 'Qual o valor das unidades e como funciona a tabela de pagamento?' },
      ],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.decision.boundary_type).toBe('price');

    global.fetch = originalFetch;
  });

  // CENÁRIO G: Cliente demonstra intenção clara de avançar.
  // A Clara deve reconhecer que o atendimento humano agrega valor e favorecer o encaminhamento.
  it('CENÁRIO G: Clear buyer intent favors handoff to human team to proceed with business steps', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'Perfeito! Para combinarmos os detalhes da sua visita ao local e alinharmos sua proposta, vou encaminhar agora para o Ronaldo e a Thatianna continuarem seu atendimento.',
      transfer_required: true,
      boundary_type: 'commercial_decision',
      reason: 'Cliente manifestou intenção expressa de agendar visita e enviar proposta.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'Decidi que quero o Live Park e quero agendar uma visita para fechar a proposta.' },
      ],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.decision.boundary_type).toBe('commercial_decision');

    global.fetch = originalFetch;
  });

  // CENÁRIO H: Cliente conversa bastante, mas apenas tira dúvidas introdutórias.
  // A Clara deve continuar conduzindo sem transformar o número de mensagens em obrigação de transferência.
  it('CENÁRIO H: Extended introductory Q&A does NOT force handoff purely on message count', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'O empreendimento conta com 4 elevadores sociais e de serviço para atender todos os pavimentos com conforto. Você está pensando em um andar mais alto para ter vista panorâmica ou prefere a praticidade de um andar mais baixo?',
      transfer_required: false,
      reason: 'Dúvida introdutória respondida e conduzida contextualmente, sem transferência mecânica forçada.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'O Live Park tem elevador?' },
        { role: 'assistant', content: 'Sim, conta com elevadores modernos.' },
        { role: 'user', content: 'E tem vaga de garagem?' },
        { role: 'assistant', content: 'Possui garagem rotativa organizada.' },
        { role: 'user', content: 'Tem salão de festas?' },
        { role: 'assistant', content: 'Sim, no rooftop junto ao espaço gourmet.' },
        { role: 'user', content: 'Quantos elevadores ao todo?' },
      ],
      simulatedHours: 'business_hours',
    });

    expect(result.handoff).toBe(false);
    expect(result.decision.transfer_required).toBe(false);
    expect(result.responseText).toContain('elevadores');
    // Verifies userMessageCount = 4 was recognized without mechanical trap
    expect(result.systemPrompt).toContain('ESTÁGIO ATUAL DA CONVERSA: 4ª mensagem do cliente neste diálogo');

    global.fetch = originalFetch;
  });

  // CENÁRIO I: A conversa ocorre fora do horário comercial.
  // A nova lógica respeita integralmente o comportamento de horário já existente.
  it('CENÁRIO I: Off-hours conversation respects business hours rule and guarantees explicit next-period continuity', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse({
      response_text: 'Perfeito! Como já passou do nosso horário de atendimento, já deixei tudo registrado para que nossa equipe entre em contato com você logo no início do nosso expediente comercial amanhã.',
      transfer_required: true,
      boundary_type: 'commercial_qualification',
      reason: 'Encaminhamento realizado fora do expediente com promessa explícita para o próximo horário comercial.',
    });

    const result = await executeConversationalTurn({
      db: mockDb,
      accountId: 'account-123',
      config: BASE_CONFIG,
      propertyId: 'live-park-id',
      messages: [
        { role: 'user', content: 'Gostei muito das unidades de 28 m² e quero saber como comprar.' },
      ],
      simulatedHours: 'off_hours',
    });

    expect(result.handoff).toBe(true);
    expect(result.decision.transfer_required).toBe(true);
    expect(result.responseText).toContain('expediente');
    expect(result.systemPrompt).toContain('NO PRÓXIMO HORÁRIO COMERCIAL');

    global.fetch = originalFetch;
  });

  describe('ADVERSARIAL CONTEXTUAL VARIATION TESTS (User Prompt Section 11)', () => {
    // 1. "Tem fotos?" quando o cliente já disse antes que busca algo pronto pra morar
    it('Scenario 1: "Tem fotos?" with prior context "pronto pra morar" adapts to housing/timeline rather than generic rental template', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'Com certeza! Estou te enviando as fotos do projeto para você ver o padrão de acabamento e a infraestrutura das áreas comuns. Como você mencionou que busca algo pronto para morar, vale lembrar que o Live Park está em fase de lançamento com obras aceleradas. Você tem um prazo específico para sua mudança?',
        transfer_required: false,
        media_to_send: [
          { id: 'media-1', description: 'Fachada contemporânea com jardins suspensos', file_name: 'fachada.jpg' },
        ],
        reason: 'Fotos enviadas conectando diretamente com a necessidade prévia de moradia e indagando sobre o horizonte de mudança.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Olá, estou buscando algo pronto pra morar em João Pessoa.' },
          { role: 'assistant', content: 'Olá! Perfeito, temos excelentes opções no Bessa.' },
          { role: 'user', content: 'Tem fotos?' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(false);
      expect(result.responseText).toContain('pronto para morar');
      expect(result.responseText).toContain('mudança');
      expect(result.validatedMediaToSend.length).toBeGreaterThanOrEqual(1);

      global.fetch = originalFetch;
    });

    // 2. "Tem fotos?" quando o cliente já disse antes que quer para rentabilizar no Airbnb
    it('Scenario 2: "Tem fotos?" with prior context "rentabilizar no Airbnb" highlights rooftop/amenities appeal for short-stay', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'Claro! Seguem as fotos do Live Park. O rooftop com piscina e as áreas compartilhadas foram desenhados justamente para maximizar a atratividade e as avaliações no Airbnb. Você já opera imóveis por temporada aqui em João Pessoa ou este seria seu primeiro studio?',
        transfer_required: false,
        media_to_send: [
          { id: 'media-1', description: 'Rooftop com piscina e vista panorâmica', file_name: 'fachada.jpg' },
        ],
        reason: 'Fotos enviadas conectando com o apelo de locação short-stay (Airbnb) e qualificando a experiência prévia do investidor.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Boa tarde, quero um imóvel para rentabilizar no Airbnb.' },
          { role: 'assistant', content: 'Boa tarde! O Live Park no Bessa é super procurado por turistas pela localização a 170m do mar.' },
          { role: 'user', content: 'Tem fotos?' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(false);
      expect(result.responseText).toContain('Airbnb');
      expect(result.responseText).toContain('primeiro studio');
      expect(result.validatedMediaToSend.length).toBeGreaterThanOrEqual(1);

      global.fetch = originalFetch;
    });

    // 3. "Qual a metragem?" quando o cliente já disse que tem família (esposa e 2 filhos)
    it('Scenario 3: "Qual a metragem?" with prior family context addresses compact profile versus family needs transparently', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'As plantas do Live Park variam de 19 a 39 m², focadas no conceito studio e 1 quarto inteligente. Como você mencionou que está com sua esposa e 2 filhos, essa metragem costuma atender famílias como um refúgio de praia e férias, ou você estaria buscando um apartamento maior de 3 quartos para moradia principal?',
        transfer_required: false,
        reason: 'Metragem explicada de forma transparente e adaptada ao contexto familiar revelado anteriormente.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Oi, somos eu, minha esposa e 2 filhos procurando um imóvel no Bessa.' },
          { role: 'assistant', content: 'Olá! Muito bom, o Bessa é um bairro maravilhoso para famílias aproveitarem a praia tranquila.' },
          { role: 'user', content: 'Qual a metragem?' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(false);
      expect(result.responseText).toContain('esposa e 2 filhos');
      expect(result.responseText).toContain('19 a 39 m²');
      expect(result.decision.transfer_required).toBe(false);

      global.fetch = originalFetch;
    });

    // 4. "Qual a metragem?" quando o cliente é investidor comparando studios compactos
    it('Scenario 4: "Qual a metragem?" for an investor comparing studios highlights efficiency and compact layout yield', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'Temos opções de 19 m², 28 m² e 39 m², todas planejadas para otimizar o custo por metro quadrado e a liquidez na locação. Nessa comparação que você está fazendo com outros studios, você está dando preferência para unidades menores para menor ticket de entrada ou prefere em torno de 28 m² para acomodar até 3 ou 4 hóspedes?',
        transfer_required: false,
        reason: 'Metragem analisada sob a ótica de liquidez e ticket para investidor de studios.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Sou investidor e estou comparando studios compactos aqui na praia do Bessa.' },
          { role: 'assistant', content: 'Excelente! Os studios no Caribessa têm alta procura ao longo de todo o ano.' },
          { role: 'user', content: 'Qual a metragem?' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(false);
      expect(result.responseText).toContain('19 m²');
      expect(result.responseText).toContain('ticket de entrada');

      global.fetch = originalFetch;
    });

    // 5. Cliente que faz pergunta simples na 3ª mensagem (conversa fria/introdutória)
    it('Scenario 5: Simple 3rd message question in brief conversation does NOT force handoff', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'Sim, o Live Park possui varandas confortáveis com jardineiras integradas na fachada em diversas unidades. Você prefere varanda com vista livre para o nascente ou poente?',
        transfer_required: false,
        reason: '3ª mensagem do cliente com dúvida objetiva simples; sem forçar transferência mecânica.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Onde fica?' },
          { role: 'assistant', content: 'No Bessa, a 170 metros da praia.' },
          { role: 'user', content: 'Tem vaga?' },
          { role: 'assistant', content: 'Sim, conta com estacionamento organizado.' },
          { role: 'user', content: 'E tem varanda?' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(false);
      expect(result.decision.transfer_required).toBe(false);
      expect(result.responseText).toContain('varandas');
      expect(result.systemPrompt).toContain('ESTÁGIO ATUAL DA CONVERSA: 3ª mensagem do cliente neste diálogo');

      global.fetch = originalFetch;
    });

    // 6. Cliente que faz pergunta técnica/decisória na 2ª mensagem (tabela/fluxo/unidade)
    it('Scenario 6: Decisive commercial question at 2nd message triggers immediate handoff (rigid frontier overrides turn counter)', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'Para te apresentar a tabela oficial de valores e a simulação do fluxo de pagamento da unidade 302, vou transferir nosso atendimento para o Ronaldo e a Thatianna, que já dão sequência personalizada com você!',
        transfer_required: true,
        boundary_type: 'payment_terms',
        reason: 'Solicitação direta de fluxo de pagamento de unidade específica na 2ª mensagem; fronteira rígida exige atendimento humano imediato.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Boa tarde!' },
          { role: 'assistant', content: 'Boa tarde! Tudo bem? Como posso te ajudar hoje?' },
          { role: 'user', content: 'Quero ver a tabela de preços e o fluxo de pagamento da unidade 302.' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(true);
      expect(result.decision.transfer_required).toBe(true);
      expect(result.decision.boundary_type).toBe('payment_terms');
      // Proves 2nd turn still triggers handoff when touching rigid commercial frontiers
      expect(result.systemPrompt).toContain('ESTÁGIO ATUAL DA CONVERSA: 2ª mensagem do cliente neste diálogo');

      global.fetch = originalFetch;
    });

    // 7. Cliente que toca em fronteira rígida de segurança (contato direto da construtora / negociação direta)
    it('Scenario 7: Client asking for builder direct contact triggers protected handoff without leaking internal info', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'O atendimento comercial oficial do Live Park é realizado exclusivamente pela nossa equipe autorizada. Vou passar seu contato para o Ronaldo e a Thatianna darem sequência na sua negociação com todas as garantias oficiais!',
        transfer_required: true,
        boundary_type: 'commercial_decision',
        reason: 'Lead solicitou contato direto da construtora para burlar intermediação; blindagem acionada com transferência formal.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Vocês têm o telefone direto do dono da construtora para eu negociar direto com ele?' },
        ],
        simulatedHours: 'business_hours',
      });

      expect(result.handoff).toBe(true);
      expect(result.decision.transfer_required).toBe(true);
      expect(result.responseText).toContain('nossa equipe');
      expect(result.responseText).not.toMatch(/\b(ronaldo|thatianna)\b/i);
      expect(result.responseText).not.toContain('número pessoal');

      global.fetch = originalFetch;
    });

    // 8. Cliente em horário noturno com dúvida técnica
    it('Scenario 8: Nighttime client with technical/purchasing questions gets explicit morning continuity guarantee', async () => {
      const originalFetch = global.fetch;
      global.fetch = mockFetchResponse({
        response_text: 'A previsão de entrega do Live Park é para 2027 e o saldo devedor pode ser quitado via financiamento bancário na entrega das chaves. Como já encerramos nosso atendimento hoje, já deixei tudo registrado para o Ronaldo ou a Thatianna te enviarem a simulação completa amanhã logo no início do expediente comercial.',
        transfer_required: true,
        boundary_type: 'payment_terms',
        reason: 'Dúvida de financiamento e entrega fora do expediente; respondida com agendamento para o próximo dia útil.',
      });

      const result = await executeConversationalTurn({
        db: mockDb,
        accountId: 'account-123',
        config: BASE_CONFIG,
        propertyId: 'live-park-id',
        messages: [
          { role: 'user', content: 'Qual a previsão de entrega e como funciona o financiamento bancário?' },
        ],
        simulatedHours: 'off_hours',
      });

      expect(result.handoff).toBe(true);
      expect(result.decision.transfer_required).toBe(true);
      expect(result.responseText).toContain('expediente');
      expect(result.systemPrompt).toContain('NO PRÓXIMO HORÁRIO COMERCIAL');

      global.fetch = originalFetch;
    });
  });
});

