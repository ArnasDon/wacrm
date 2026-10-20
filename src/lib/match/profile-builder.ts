import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadSearchProfile, InfoProvenance, DeliveryStatus, PropertyOperation } from './types';

interface ContactRow {
  id: string;
  account_id: string;
  name: string | null;
  phone: string;
  ai_score: number | null;
  paused_at: string | null;
  archived_at: string | null;
}

interface TagWithJoin {
  source: string;
  originally_from_ctwa: boolean;
  tags: {
    id: string;
    name: string;
    category: string | null;
  } | null;
}

/**
 * Constrói o LeadSearchProfile agregando dados de contacts, lead_intelligence,
 * tags com proveniência e ctwa_referral da conversa mais recente.
 */
export async function buildLeadSearchProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<LeadSearchProfile | null> {
  const [
    { data: contact },
    { data: intelligence },
    { data: contactTags },
    { data: conversation },
  ] = await Promise.all([
    db
      .from('contacts')
      .select('id, account_id, name, phone, ai_score, paused_at, archived_at')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle<ContactRow>(),
    db
      .from('lead_intelligence')
      .select('summary')
      .eq('contact_id', contactId)
      .maybeSingle<{ summary: Record<string, unknown> }>(),
    db
      .from('contact_tags')
      .select('source, originally_from_ctwa, tags!inner(id, name, category)')
      .eq('contact_id', contactId)
      .returns<TagWithJoin[]>(),
    db
      .from('conversations')
      .select('id, ctwa_referral')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; ctwa_referral: Record<string, unknown> | null }>(),
  ]);

  if (!contact) return null;

  const rawSummary = (intelligence?.summary || {}) as Record<string, unknown>;
  const ctwaReferral = conversation?.ctwa_referral || null;

  // Processa tags por categoria e proveniência
  const tagCategories: Record<string, { names: string[]; source: InfoProvenance }[]> = {};
  for (const ct of contactTags || []) {
    const t = ct.tags;
    if (!t || !t.category) continue;
    const cat = t.category.trim();
    const src = (ct.source as InfoProvenance) || 'conversation';
    (tagCategories[cat] ??= []).push({ names: [t.name], source: src });
  }

  // Helper para resolver proveniência de uma categoria
  const resolveProvenance = (cat: string, fallbackFromCtwa = false): InfoProvenance => {
    const entries = tagCategories[cat] || [];
    // Conversa ou manual sempre tem prioridade sobre CTWA
    if (entries.some((e) => e.source === 'conversation' || e.source === 'manual')) {
      return 'conversation';
    }
    if (entries.some((e) => e.source === 'ctwa') || fallbackFromCtwa) {
      return 'ctwa';
    }
    return 'conversation';
  };

  // 1. Finalidade (resolvida antes da operação para diferenciar investidor de locatário)
  const rawPurpose = Array.isArray(rawSummary.purpose)
    ? (rawSummary.purpose as unknown[]).map((p) => String(p))
    : [];
  const notesText = typeof rawSummary.notes === 'string' ? rawSummary.notes : '';

  const purposeList = [...rawPurpose];
  const finalidadeTags = tagCategories['Finalidade'] || [];
  for (const ft of finalidadeTags) {
    for (const name of ft.names) {
      if (!purposeList.includes(name)) purposeList.push(name);
    }
  }

  const hasBuyerPurpose = purposeList.some((p) => {
    const norm = normalizeString(p);
    return (
      norm.includes('invest') ||
      norm.includes('moradia') ||
      norm.includes('compra') ||
      norm.includes('venda')
    );
  });

  // 2. Operação (compra vs aluguel)
  // Se o lead tem finalidade de Investimento ou Moradia, menções a "temporada" ou "locação"
  // nas notas referem-se à rentabilidade do imóvel comprado (ex: flat para Airbnb), e NÃO que ele quer alugar.
  let operation: PropertyOperation = 'venda';
  let isShortStayOnly = false;

  if (!hasBuyerPurpose) {
    const wantsShortStay =
      rawPurpose.some((p) => normalizeString(p).includes('temporada')) ||
      (notesText.toLowerCase().includes('temporada') &&
        !notesText.toLowerCase().includes('planta') &&
        !notesText.toLowerCase().includes('invest'));

    if (wantsShortStay) {
      isShortStayOnly = true;
    }

    const wantsRentOnly =
      rawPurpose.some((p) => {
        const norm = normalizeString(p);
        return norm.includes('aluguel') || norm.includes('loca');
      }) ||
      ((notesText.toLowerCase().includes('busca locação') ||
        notesText.toLowerCase().includes('procura aluguel')) &&
        !notesText.toLowerCase().includes('planta'));

    if (wantsRentOnly) {
      operation = 'locacao';
    }
  }

  // 3. Tipologias
  const propertyTypes = Array.isArray(rawSummary.property_type)
    ? (rawSummary.property_type as unknown[]).map((t) => String(t))
    : [];
  const tipoTags = tagCategories['Tipo de imóvel'] || [];
  for (const tt of tipoTags) {
    for (const name of tt.names) {
      if (!propertyTypes.includes(name)) propertyTypes.push(name);
    }
  }

  // 4. Localizações / Bairros
  const locations = Array.isArray(rawSummary.location)
    ? (rawSummary.location as unknown[]).map((l) => String(l))
    : [];
  const bairroTags = tagCategories['Bairro'] || [];
  for (const bt of bairroTags) {
    for (const name of bt.names) {
      if (!locations.includes(name)) locations.push(name);
    }
  }

  // 5. Preço (suporta number ou string numérica como "300000" / "R$ 450.000")
  const parsePriceValue = (val: unknown): number | null => {
    if (typeof val === 'number' && !Number.isNaN(val) && val > 0) {
      return val < 2000 ? val * 1000 : val;
    }
    if (typeof val === 'string' && val.trim() !== '') {
      const cleaned = val.replace(/[R$\s.]/g, '').replace(',', '.');
      const num = Number(cleaned);
      if (!Number.isNaN(num) && num > 0) {
        return num < 2000 ? num * 1000 : num;
      }
    }
    return null;
  };

  const priceMin = parsePriceValue(rawSummary.price_min);
  let priceMax = parsePriceValue(rawSummary.price_max);
  const priceFlexMax = parsePriceValue(rawSummary.price_flex_max);

  // Extrai de tag 'Faixa de valor' se não estiver no summary
  if (priceMax === null) {
    const valorTags = tagCategories['Faixa de valor'] || [];
    for (const vt of valorTags) {
      for (const name of vt.names) {
        const numbers = name.replace(/\./g, '').match(/\d+/g);
        if (numbers && numbers.length > 0) {
          const parsed = parseInt(numbers[numbers.length - 1], 10);
          if (parsed > 0) priceMax = parsed < 2000 ? parsed * 1000 : parsed;
        }
      }
    }
  }

  // 6. Quartos (suporta number ou string como "2" / "2 quartos")
  const bedrooms: number[] = [];
  if (Array.isArray(rawSummary.bedrooms)) {
    for (const item of rawSummary.bedrooms) {
      if (typeof item === 'number' && !Number.isNaN(item)) {
        if (!bedrooms.includes(item)) bedrooms.push(item);
      } else if (typeof item === 'string') {
        const m = item.match(/\d+/);
        if (m) {
          const v = parseInt(m[0], 10);
          if (!bedrooms.includes(v)) bedrooms.push(v);
        }
      }
    }
  }
  const quartosTags = tagCategories['Quartos'] || [];
  for (const qt of quartosTags) {
    for (const name of qt.names) {
      const matchNum = name.match(/\d+/);
      if (matchNum) {
        const val = parseInt(matchNum[0], 10);
        if (!bedrooms.includes(val)) bedrooms.push(val);
      }
    }
  }

  // 7. Pronto / Planta
  const deliveryStatus: DeliveryStatus[] = [];
  const statusTags = tagCategories['Status'] || [];
  const allStatusTexts = [
    ...statusTags.flatMap((s) => s.names),
    notesText,
    ...(Array.isArray(rawSummary.features) ? (rawSummary.features as string[]) : []),
  ].map((t) => t.toLowerCase());

  if (allStatusTexts.some((t) => t.includes('pronto'))) deliveryStatus.push('pronto');
  if (allStatusTexts.some((t) => t.includes('planta'))) deliveryStatus.push('planta');
  if (allStatusTexts.some((t) => t.includes('constru') || t.includes('obra'))) {
    deliveryStatus.push('em_construcao');
  }

  // 8. Requisitos obrigatórios vs Preferências
  const reqObj = (rawSummary.requirements as Record<string, unknown>) || {};
  const propertyTypeStrict = reqObj.property_type_strict === true;
  const locationStrict = reqObj.location_strict === true;
  const priceStrictMax = reqObj.price_strict_max === true;
  const bedroomsStrict = reqObj.bedrooms_strict === true;
  const deliveryStrict = reqObj.delivery_strict === true;

  const requiredFeatures = Array.isArray(reqObj.required_features)
    ? (reqObj.required_features as string[])
    : [];

  const preferredFeatures = Array.isArray(rawSummary.features)
    ? (rawSummary.features as string[]).filter((f) => !requiredFeatures.includes(f))
    : [];

  // Especificidade de localização
  let locationSpecificity: 'city' | 'region' | 'neighborhood' = 'neighborhood';
  if (locations.length === 1 && normalizeString(locations[0]).includes('joao pessoa')) {
    locationSpecificity = 'city';
  } else if (locations.some((l) => l.toLowerCase().includes('praia') || l.toLowerCase().includes('sul'))) {
    locationSpecificity = 'region';
  }

  const hasCtwa = !!ctwaReferral;

  return {
    accountId,
    leadId: contact.id,
    name: contact.name || 'Lead',
    phone: contact.phone,
    aiScore: contact.ai_score ?? 0,
    isPaused: contact.paused_at !== null,
    isArchived: contact.archived_at !== null,
    operation,
    purpose: purposeList,
    propertyTypes,
    propertyTypeStrict,
    locations,
    locationStrict,
    locationSpecificity,
    priceMin,
    priceMax,
    priceStrictMax,
    priceFlexMax,
    bedrooms,
    bedroomsStrict,
    deliveryStatus,
    deliveryStrict,
    requiredFeatures,
    preferredFeatures,
    isShortStayOnly,
    provenance: {
      operation: resolveProvenance('Finalidade', hasCtwa),
      purpose: resolveProvenance('Finalidade', hasCtwa),
      propertyTypes: resolveProvenance('Tipo de imóvel', hasCtwa),
      locations: resolveProvenance('Bairro', hasCtwa),
      price: resolveProvenance('Faixa de valor', hasCtwa),
      bedrooms: resolveProvenance('Quartos', hasCtwa),
      delivery: resolveProvenance('Status', hasCtwa),
      features: resolveProvenance('Momento', hasCtwa),
    },
  };
}

function normalizeString(val: string): string {
  return val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
