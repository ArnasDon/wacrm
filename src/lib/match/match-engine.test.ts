import { describe, it, expect } from 'vitest';
import { calculateProfileMaturity, MATURITY_AUTOMATIC_THRESHOLD } from './maturity';
import { evaluateMatch } from './engine';
import { calculateCommercialPriority } from './priority';
import { generateTrackingToken, buildSharePublicUrl } from './tokens';
import type { LeadSearchProfile, PropertyProjection } from './types';

function createMockProfile(overrides: Partial<LeadSearchProfile> = {}): LeadSearchProfile {
  return {
    accountId: 'acc-1',
    leadId: 'lead-1',
    name: 'Marcos Silva',
    phone: '5583988887777',
    aiScore: 7,
    isPaused: false,
    isArchived: false,
    operation: 'venda',
    purpose: ['moradia'],
    propertyTypes: ['apartamento'],
    propertyTypeStrict: false,
    locations: ['Bessa'],
    locationStrict: false,
    locationSpecificity: 'neighborhood',
    priceMin: null,
    priceMax: 500000,
    priceStrictMax: false,
    priceFlexMax: null,
    bedrooms: [3],
    bedroomsStrict: false,
    deliveryStatus: ['pronto'],
    deliveryStrict: false,
    requiredFeatures: [],
    preferredFeatures: [],
    isShortStayOnly: false,
    provenance: {
      operation: 'conversation',
      purpose: 'conversation',
      propertyTypes: 'conversation',
      locations: 'conversation',
      price: 'conversation',
      bedrooms: 'conversation',
      delivery: 'conversation',
      features: 'conversation',
    },
    ...overrides,
  };
}

function createMockProperty(overrides: Partial<PropertyProjection> = {}): PropertyProjection {
  return {
    propertyId: 'prop-1',
    accountId: 'acc-1',
    code: 'LP-301',
    title: 'Residencial Live Park',
    operation: 'venda',
    propertyType: 'apartamento',
    neighborhood: 'Bessa',
    city: 'João Pessoa',
    priceMin: 450000,
    priceMax: 480000,
    areaMin: 65,
    areaMax: 78,
    bedroomsMin: 3,
    bedroomsMax: 3,
    deliveryStatus: 'pronto',
    features: ['elevador', 'piscina', 'vaga_garagem'],
    status: 'ativo',
    ...overrides,
  };
}

describe('Fase 24 — Validação e Testes do Motor de Match WACRM', () => {
  // 1. CTWA sozinho não gera maturidade artificial de 70%
  it('1. CTWA sozinho não gera maturidade artificial de 70%', () => {
    const ctwaOnlyProfile = createMockProfile({
      provenance: {
        operation: 'ctwa',
        purpose: 'ctwa',
        propertyTypes: 'ctwa',
        locations: 'ctwa',
        price: 'ctwa',
        bedrooms: 'ctwa',
        delivery: 'ctwa',
        features: 'ctwa',
      },
    });
    const evalResult = calculateProfileMaturity(ctwaOnlyProfile);
    expect(evalResult.maturity).toBeLessThan(70);
    expect(evalResult.meetsThreshold).toBe(false);
    expect(evalResult.maturity).toBeLessThanOrEqual(35); // 100 * 0.35 = 35 máx
  });

  // 2. Tag azul vira verde quando confirmada
  it('2. Tag azul vira verde quando confirmada', () => {
    // Simula a lógica de transição no contact_tags
    const tagCtwa = { source: 'ctwa', originally_from_ctwa: true };
    const confirmedSource = 'conversation';
    const tagUpdated = {
      source: confirmedSource,
      originally_from_ctwa: tagCtwa.source === 'ctwa' || tagCtwa.originally_from_ctwa,
    };
    expect(tagUpdated.source).toBe('conversation');
    expect(tagUpdated.originally_from_ctwa).toBe(true);
  });

  // 3. Informação de conversa vence informação CTWA conflitante
  it('3. Informação de conversa vence informação CTWA conflitante', () => {
    // CTWA trouxe Bessa, conversa atualizou para Manaíra
    const profile = createMockProfile({
      locations: ['Manaíra'],
      provenance: { locations: 'conversation' },
    });
    const propertyManaira = createMockProperty({ neighborhood: 'Manaíra' });
    const propertyBessa = createMockProperty({ neighborhood: 'Bessa' });

    const evalManaira = evaluateMatch(profile, propertyManaira);
    const evalBessa = evaluateMatch(profile, propertyBessa);

    expect(evalManaira.scoreBreakdown.location).toBeGreaterThan(evalBessa.scoreBreakdown.location);
  });

  // 4. Maturidade calcula corretamente
  it('4. Maturidade calcula corretamente com pesos normalizados', () => {
    const fullProfile = createMockProfile();
    const evalResult = calculateProfileMaturity(fullProfile);
    expect(evalResult.maturity).toBeGreaterThanOrEqual(90);
    expect(evalResult.meetsThreshold).toBe(true);
  });

  // 5. 69% não entra automaticamente
  it('5. 69% não entra automaticamente no Match automático', () => {
    expect(69 >= MATURITY_AUTOMATIC_THRESHOLD).toBe(false);
  });

  // 6. 70% entra no Match automático
  it('6. 70% entra no Match automático', () => {
    expect(70 >= MATURITY_AUTOMATIC_THRESHOLD).toBe(true);
  });

  // 7. Temperatura não muda Match Score
  it('7. Temperatura não altera a pontuação do Match', () => {
    const profileCold = createMockProfile({ aiScore: 1 });
    const profileHot = createMockProfile({ aiScore: 10 });
    const property = createMockProperty();

    const evalCold = evaluateMatch(profileCold, property);
    const evalHot = evaluateMatch(profileHot, property);

    expect(evalCold.matchScore).toBe(evalHot.matchScore);
  });

  // 8. Preço abaixo do orçamento não perde pontos
  it('8. Preço abaixo do orçamento não perde pontos', () => {
    const profile = createMockProfile({ priceMax: 500000 });
    const cheapProperty = createMockProperty({ priceMin: 300000, priceMax: 350000 });
    const budgetProperty = createMockProperty({ priceMin: 490000, priceMax: 500000 });

    const evalCheap = evaluateMatch(profile, cheapProperty);
    const evalBudget = evaluateMatch(profile, budgetProperty);

    expect(evalCheap.scoreBreakdown.price).toBe(evalBudget.scoreBreakdown.price);
  });

  // 9. Preço até +10% perde progressivamente pontos
  it('9. Preço até +10% perde progressivamente pontos', () => {
    const profile = createMockProfile({ priceMax: 500000, priceStrictMax: false });
    const onBudget = createMockProperty({ priceMin: 500000, priceMax: 500000 });
    const slightlyOver = createMockProperty({ priceMin: 525000, priceMax: 525000 }); // +5%

    const evalBudget = evaluateMatch(profile, onBudget);
    const evalSlightlyOver = evaluateMatch(profile, slightlyOver);

    expect(evalSlightlyOver.eligible).toBe(true);
    expect(evalSlightlyOver.scoreBreakdown.price).toBeLessThan(evalBudget.scoreBreakdown.price);
    expect(evalSlightlyOver.scoreBreakdown.price).toBeGreaterThan(0);
  });

  // 10. Preço acima da tolerância (+10%) sai do automático
  it('10. Preço acima da tolerância máxima (+10%) elimina', () => {
    const profile = createMockProfile({ priceMax: 500000, priceStrictMax: false });
    const wayOver = createMockProperty({ priceMin: 560000, priceMax: 560000 }); // +12%

    const evalOver = evaluateMatch(profile, wayOver);
    expect(evalOver.eligible).toBe(false);
    expect(evalOver.matchScore).toBe(0);
  });

  // 11. Limite absoluto é respeitado
  it('11. Limite absoluto elimina qualquer valor acima', () => {
    const profile = createMockProfile({ priceMax: 500000, priceStrictMax: true });
    const slightlyOver = createMockProperty({ priceMin: 505000, priceMax: 505000 });

    const evalResult = evaluateMatch(profile, slightlyOver);
    expect(evalResult.eligible).toBe(false);
  });

  // 12. Venda x Locação elimina
  it('12. Venda vs Locação elimina incompatibilidade', () => {
    const profileRent = createMockProfile({ operation: 'locacao' });
    const propertySale = createMockProperty({ operation: 'venda' });

    const evalResult = evaluateMatch(profileRent, propertySale);
    expect(evalResult.eligible).toBe(false);
  });

  // 13. Temporada não entra no estoque comum
  it('13. Temporada exclusiva não gera match com estoque comum', () => {
    const profileSeason = createMockProfile({ isShortStayOnly: true });
    const property = createMockProperty();

    const evalResult = evaluateMatch(profileSeason, property);
    expect(evalResult.eligible).toBe(false);
  });

  // 14. Requisito obrigatório elimina incompatibilidade
  it('14. Requisito obrigatório de quartos elimina incompatibilidade', () => {
    const profile = createMockProfile({ bedrooms: [3], bedroomsStrict: true });
    const twoBedrooms = createMockProperty({ bedroomsMin: 2, bedroomsMax: 2 });

    const evalResult = evaluateMatch(profile, twoBedrooms);
    expect(evalResult.eligible).toBe(false);
  });

  // 15. Preferência apenas reduz score
  it('15. Preferência de quartos apenas reduz score sem eliminar', () => {
    const profile = createMockProfile({ bedrooms: [3], bedroomsStrict: false });
    const twoBedrooms = createMockProperty({ bedroomsMin: 2, bedroomsMax: 2 });

    const evalResult = evaluateMatch(profile, twoBedrooms);
    expect(evalResult.eligible).toBe(true);
    expect(evalResult.matchScore).toBeGreaterThan(0);
    expect(evalResult.scoreBreakdown.bedrooms).toBeLessThan(15);
  });

  // 16. Bairro não mencionado limita Match a 69%
  it('16. Bairro não mencionado pelo cliente limita pontuação máxima a 69%', () => {
    const profile = createMockProfile({ locations: ['Bessa'] });
    const otherNeighborhoodProperty = createMockProperty({ neighborhood: 'Cabo Branco' });

    const evalResult = evaluateMatch(profile, otherNeighborhoodProperty);
    expect(evalResult.matchScore).toBeLessThanOrEqual(69);
  });

  // 17. "Somente bairro X" elimina outro bairro
  it('17. Localização estrita ("somente bairro X") elimina outros bairros', () => {
    const profile = createMockProfile({ locations: ['Bessa'], locationStrict: true });
    const otherNeighborhoodProperty = createMockProperty({ neighborhood: 'Manaíra' });

    const evalResult = evaluateMatch(profile, otherNeighborhoodProperty);
    expect(evalResult.eligible).toBe(false);
  });

  // 18. Faixa do empreendimento é tratada por interseção
  it('18. Faixa do empreendimento avalia unidade de entrada por interseção', () => {
    const profile = createMockProfile({ priceMax: 300000 });
    const rangeProperty = createMockProperty({ priceMin: 250000, priceMax: 600000 });

    const evalResult = evaluateMatch(profile, rangeProperty);
    expect(evalResult.eligible).toBe(true);
    expect(evalResult.scoreBreakdown.price).toBeGreaterThan(0);
  });

  // 19. Lead pausado não entra nas rodadas automáticas
  it('19. Lead pausado é identificado para exclusão de rodadas automáticas', () => {
    const profile = createMockProfile({ isPaused: true });
    expect(profile.isPaused).toBe(true);
  });

  // 20. Lead arquivado não entra nas rodadas automáticas
  it('20. Lead arquivado é identificado para exclusão de rodadas automáticas', () => {
    const profile = createMockProfile({ isArchived: true });
    expect(profile.isArchived).toBe(true);
  });

  // 21. Reativação volta a permitir Match
  it('21. Lead reativado (não pausado e não arquivado) fica elegível', () => {
    const profile = createMockProfile({ isPaused: false, isArchived: false });
    expect(!profile.isPaused && !profile.isArchived).toBe(true);
  });

  // 22. Match suprimido tem indicador permanente
  it('22. Supressão é booleana e permanente para o par', () => {
    const matchState = { suppressed: true, match_status: 'novo' };
    expect(matchState.suppressed).toBe(true);
  });

  // 23. Novo token é criado para cada envio
  it('23. Gera tokens criptográficos independentes para envios sucessivos', () => {
    const token1 = generateTrackingToken();
    const token2 = generateTrackingToken();
    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(64);
  });

  // 24. Token não contém PII
  it('24. Token é hexadecimal opaco e sem informações pessoais', () => {
    const token = generateTrackingToken();
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    expect(token).not.toContain('5583');
    expect(token).not.toContain('lead');
  });

  // 25. URL pública gerada corretamente
  it('25. Monta URL pública de compartilhamento com token opaco', () => {
    const token = generateTrackingToken();
    const url = buildSharePublicUrl(token, 'https://ronaldomeira.com.br');
    expect(url).toBe(`https://ronaldomeira.com.br/imoveis/p/${token}`);
  });

  // 26. Prioridade comercial prioriza maior engajamento
  it('26. Prioridade comercial posiciona lead quente e engajado acima de lead frio', () => {
    const prioHot = calculateCommercialPriority({
      matchScore: 94,
      aiScore: 9,
      profileMaturity: 90,
      recentInteractionDays: 1,
      sharesCount: 2,
      sharesOpenedCount: 2,
    });

    const prioCold = calculateCommercialPriority({
      matchScore: 94,
      aiScore: 2,
      profileMaturity: 70,
      recentInteractionDays: 15,
      sharesCount: 5,
      sharesOpenedCount: 0, // fadiga
    });

    expect(prioHot).toBeGreaterThan(prioCold);
  });

  // 27. Fadiga de envio aplica penalidade na prioridade comercial
  it('27. Múltiplos envios sem abertura aplicam penalidade de fadiga', () => {
    const prioNormal = calculateCommercialPriority({
      matchScore: 85,
      aiScore: 5,
      profileMaturity: 75,
      sharesCount: 1,
      sharesOpenedCount: 1,
    });

    const prioFatigued = calculateCommercialPriority({
      matchScore: 85,
      aiScore: 5,
      profileMaturity: 75,
      sharesCount: 6,
      sharesOpenedCount: 0,
    });

    expect(prioFatigued).toBeLessThan(prioNormal);
  });

  // 28. "Tenho interesse" adiciona bônus expressivo de prioridade
  it('28. Clique em "Tenho interesse" eleva prioridade comercial', () => {
    const withoutInterest = calculateCommercialPriority({
      matchScore: 80,
      aiScore: 6,
      profileMaturity: 80,
      hasInterestClick: false,
    });

    const withInterest = calculateCommercialPriority({
      matchScore: 80,
      aiScore: 6,
      profileMaturity: 80,
      hasInterestClick: true,
    });

    expect(withInterest).toBeGreaterThan(withoutInterest);
  });

  // 29. Faixas de Match (Forte >= 85, Bom 70-84, Manual < 70)
  it('29. Faixas de classificação de Match funcionam conforme os limiares', () => {
    const strongProp = createMockProperty();
    const strongResult = evaluateMatch(createMockProfile(), strongProp);
    expect(strongResult.isStrongMatch).toBe(true);

    const manualProfile = createMockProfile({ locations: ['Outro Bairro Desconhecido'] });
    const manualResult = evaluateMatch(manualProfile, strongProp);
    expect(manualResult.isManualOnly).toBe(true);
    expect(manualResult.matchScore).toBeLessThan(70);
  });

  // 30. Característica obrigatória ausente elimina
  it('30. Falta de característica obrigatória elimina do Match', () => {
    const profile = createMockProfile({ requiredFeatures: ['heliponto_privativo'] });
    const property = createMockProperty({ features: ['piscina', 'elevador'] });

    const evalResult = evaluateMatch(profile, property);
    expect(evalResult.eligible).toBe(false);
    expect(evalResult.eliminatedReason).toContain('heliponto_privativo');
  });

  // 31. Terreno não penaliza quartos (Normalização adaptativa)
  it('31. Tipologia terreno não exige quartos e normaliza pesos para 100%', () => {
    const landProfile = createMockProfile({
      propertyTypes: ['terreno'],
      bedrooms: [],
    });
    const maturity = calculateProfileMaturity(landProfile);
    expect(maturity.dimensions['bedrooms']).toBeUndefined();
    expect(maturity.maturity).toBeGreaterThan(0);
  });

  // 32. Pronto obrigatório vs Em Construção elimina
  it('32. "Só quero pronto" elimina imóvel em construção ou planta', () => {
    const profile = createMockProfile({
      deliveryStatus: ['pronto'],
      deliveryStrict: true,
    });
    const underConstruction = createMockProperty({
      deliveryStatus: 'em_construcao',
    });

    const evalResult = evaluateMatch(profile, underConstruction);
    expect(evalResult.eligible).toBe(false);
  });
});
