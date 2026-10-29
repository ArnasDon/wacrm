import { describe, expect, it } from 'vitest';
import { buildConversationalSystemPrompt } from './prompt-builder';
import type { AiConfig, PropertyMediaSummary } from './types';

const BASE_CONFIG: AiConfig = {
  provider: 'openai',
  model: 'gpt-5.4-mini',
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
    'Nunca force perguntas pré-fabricadas.',
  ],
};

const SAMPLE_PROPERTY = {
  id: 'prop-puerto-ventura',
  name: 'Puerto Ventura',
  stage: 'Pronto',
  status: 'ativo',
};

const SAMPLE_KNOWLEDGE = [
  `[Ficha Técnica Oficial]
Puerto Ventura na Avenida Cabo Branco, João Pessoa/PB.
Unidades com 45 m², 1 quarto com sala, cozinha e banheiro separados.
Totalmente mobiliado e decorado.
Posição sul com vista lateral para o mar.`,
];

const SAMPLE_MEDIA: PropertyMediaSummary[] = [
  {
    id: 'media-fachada',
    type: 'image',
    description: 'Fachada frontal do Puerto Ventura',
    file_name: 'fachada_ultra_hd_2026.jpg',
    is_cover: true,
  },
  {
    id: 'media-piscina',
    type: 'image',
    description: 'Piscina na cobertura com vista para a praia',
    file_name: 'piscina_rooftop.jpg',
    is_cover: false,
  },
];

describe('Clara Cost Optimization & Prompt Caching Verification Suite', () => {
  it('1. Cache Prefix Stability: consecutive turns (turn 2, turn 3, turn 4) share an invariant prefix >= 1,024 tokens', () => {
    // Turn 2
    const promptTurn2 = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      isInitialContact: false,
      userMessageCount: 2,
      property: SAMPLE_PROPERTY,
      propertyKnowledge: SAMPLE_KNOWLEDGE,
      propertyMedia: SAMPLE_MEDIA,
      communicatedContent: ['Olá! Sou a Clara assistente do Ronaldo Meira.'],
    });

    // Turn 3
    const promptTurn3 = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      isInitialContact: false,
      userMessageCount: 3,
      property: SAMPLE_PROPERTY,
      propertyKnowledge: SAMPLE_KNOWLEDGE,
      propertyMedia: SAMPLE_MEDIA,
      communicatedContent: [
        'Olá! Sou a Clara assistente do Ronaldo Meira.',
        'O flat tem 45 m² e 1 quarto mobiliado.',
      ],
    });

    // Find the common prefix between Turn 2 and Turn 3
    let commonPrefixLength = 0;
    while (
      commonPrefixLength < promptTurn2.length &&
      commonPrefixLength < promptTurn3.length &&
      promptTurn2[commonPrefixLength] === promptTurn3[commonPrefixLength]
    ) {
      commonPrefixLength++;
    }

    const commonPrefix = promptTurn2.slice(0, commonPrefixLength);

    // Approximate token count: 1 token ~ 4 characters in Portuguese / English mixed prompt
    const approxTokens = Math.floor(commonPrefix.length / 4);

    // Assert that the invariant prefix is well above OpenAI minimum cache threshold of 1,024 tokens
    expect(approxTokens).toBeGreaterThanOrEqual(1024);
    // Specifically, Sections 1 through 7 and static Section 8 knowledge are fully part of the common prefix!
    expect(commonPrefix).toContain('=== 1. MISSÃO PRINCIPAL E PAPEL NO ATENDIMENTO ===');
    expect(commonPrefix).toContain('=== 2. PERSONALIDADE, TOM DE VOZ E MALEMOLÊNCIA ===');
    expect(commonPrefix).toContain('=== 4. FRONTEIRAS RÍGIDAS');
    expect(commonPrefix).toContain('=== 7. HIERARQUIA DE AUTORIDADE E SEGURANÇA ===');
    expect(commonPrefix).toContain('=== 8. CONHECIMENTO ESPECÍFICO DO EMPREENDIMENTO (ISOLAMENTO ESTRITO) ===');
    expect(commonPrefix).toContain('Puerto Ventura na Avenida Cabo Branco');
  });

  it('2. Media Catalog Optimization: mediaList omits file_name and serializes compactly', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: SAMPLE_PROPERTY,
      propertyMedia: SAMPLE_MEDIA,
    });

    // Contains essential identification & description
    expect(prompt).toContain('media-fachada');
    expect(prompt).toContain('Fachada frontal do Puerto Ventura');
    expect(prompt).toContain('media-piscina');
    // Does NOT waste tokens serializing internal storage file_name into the LLM prompt
    expect(prompt).not.toContain('fachada_ultra_hd_2026.jpg');
    expect(prompt).not.toContain('piscina_rooftop.jpg');
  });

  it('3. Message History Deduplication: previous assistant messages are referenced via native chat history and are NOT duplicated verbatim in the system prompt', () => {
    const previousMessages = [
      'Msg 1: Primeira resposta longa da Clara sobre o condomínio',
      'Msg 2: Segunda resposta com detalhes do flat de 45 m²',
      'Msg 3: Terceira resposta sobre lazer e piscina',
    ];

    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      property: SAMPLE_PROPERTY,
      communicatedContent: previousMessages,
    });

    // The explicit progression directive is present
    expect(prompt).toContain('INFORMAÇÕES JÁ COMUNICADAS AO CLIENTE');
    expect(prompt).toContain('Considere o histórico recente');
    expect(prompt).toContain('não reapresente informações como novidade nem repita blocos');

    // Verbatim text of previous messages is NOT duplicated in the system prompt (saving hundreds of tokens)
    expect(prompt).not.toContain('Msg 1: Primeira resposta longa da Clara sobre o condomínio');
    expect(prompt).not.toContain('Msg 2: Segunda resposta com detalhes do flat de 45 m²');
    expect(prompt).not.toContain('Msg 3: Terceira resposta sobre lazer e piscina');
  });

  it('4. Turn Context placement in Section 10: turn-specific message count is preserved without breaking prefix cache', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      userMessageCount: 3,
    });

    // Section 10 contains the turn context
    expect(prompt).toContain('=== 10. MEMÓRIA E CONTEXTO DO LEAD');
    expect(prompt).toContain('ESTÁGIO ATUAL DA CONVERSA: 3ª mensagem do cliente neste diálogo');
    expect(prompt).toContain('aplique a tendência progressiva de encaminhamento');
  });

  it('5. Greeting Section placement: ongoing conversation greeting prohibition is preserved in Section 2', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      isInitialContact: false,
    });

    expect(prompt).toContain('ESTADO DA CONVERSA: CONVERSA JÁ EM ANDAMENTO');
    expect(prompt).toContain('REGRA ABSOLUTA E INEGOCIÁVEL DE SAUDAÇÃO');
    expect(prompt).toContain('É ESTRITAMENTE PROIBIDO iniciar sua resposta com saudações');
  });

  it('6. Initial contact greeting allowance is preserved on first contact', () => {
    const prompt = buildConversationalSystemPrompt({
      config: BASE_CONFIG,
      mode: 'auto_reply',
      isInitialContact: true,
    });

    expect(prompt).toContain('ESTADO DA CONVERSA: PRIMEIRO CONTATO DO CLIENTE');
    expect(prompt).toContain('você PODE abrir com uma saudação calorosa');
  });
});
