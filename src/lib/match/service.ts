import type { SupabaseClient } from '@supabase/supabase-js';
import { buildLeadSearchProfile } from './profile-builder';
import { calculateProfileMaturity, MATURITY_AUTOMATIC_THRESHOLD } from './maturity';
import { evaluateMatch } from './engine';
import { calculateCommercialPriority } from './priority';
import { generateTrackingToken, buildSharePublicUrl } from './tokens';
import { sendPushToAccount } from '@/lib/push/send';
import type {
  PropertyProjection,
  MatchRecord,
  PropertyShareRecord,
  MatchStatus,
  MatchOrigin,
} from './types';

export interface RecalculateLeadMatchesResult {
  leadId: string;
  maturity: number;
  meetsThreshold: boolean;
  totalPropertiesEvaluated: number;
  matchesCreatedOrUpdated: number;
  strongMatchesCount: number;
}

/**
 * Recalcula todos os Matches de um lead contra os imóveis ativos do catálogo.
 * Respeita supressão permanente, proveniência e limites de pausa/arquivamento.
 */
export async function recalculateMatchesForLead(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<RecalculateLeadMatchesResult> {
  const profile = await buildLeadSearchProfile(db, accountId, contactId);
  if (!profile) {
    return {
      leadId: contactId,
      maturity: 0,
      meetsThreshold: false,
      totalPropertiesEvaluated: 0,
      matchesCreatedOrUpdated: 0,
      strongMatchesCount: 0,
    };
  }

  // FASE 10: Leads pausados ou arquivados NÃO participam de novas rodadas automáticas
  if (profile.isPaused || profile.isArchived) {
    return {
      leadId: contactId,
      maturity: 0,
      meetsThreshold: false,
      totalPropertiesEvaluated: 0,
      matchesCreatedOrUpdated: 0,
      strongMatchesCount: 0,
    };
  }

  const maturityEval = calculateProfileMaturity(profile);

  // Busca todos os imóveis ativos da conta
  const { data: propertiesRaw, error: propErr } = await db
    .from('property_match_projections')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'ativo');

  if (propErr) {
    console.error('[match-service] Falha ao buscar projeções de imóveis:', propErr);
    return {
      leadId: contactId,
      maturity: maturityEval.maturity,
      meetsThreshold: maturityEval.meetsThreshold,
      totalPropertiesEvaluated: 0,
      matchesCreatedOrUpdated: 0,
      strongMatchesCount: 0,
    };
  }

  const properties: PropertyProjection[] = (propertiesRaw || []).map((p) => ({
    id: p.id,
    propertyId: p.property_id,
    accountId: p.account_id,
    code: p.code,
    title: p.title,
    operation: p.operation,
    propertyType: p.property_type,
    neighborhood: p.neighborhood,
    city: p.city,
    priceMin: Number(p.price_min),
    priceMax: Number(p.price_max),
    areaMin: p.area_min ? Number(p.area_min) : null,
    areaMax: p.area_max ? Number(p.area_max) : null,
    bedroomsMin: p.bedrooms_min,
    bedroomsMax: p.bedrooms_max,
    deliveryStatus: p.delivery_status,
    deliveryDeadline: p.delivery_deadline,
    features: p.features || [],
    coverUrl: p.cover_url,
    publicUrl: p.public_url,
    status: p.status,
  }));

  // Busca Matches já existentes para este lead (para checar supressões e estados atuais)
  const { data: existingMatches } = await db
    .from('lead_property_matches')
    .select('id, property_id, match_status, suppressed, match_score, origin')
    .eq('account_id', accountId)
    .eq('lead_id', contactId);

  const existingMap = new Map<string, {
    id: string;
    match_status: MatchStatus;
    suppressed: boolean;
    match_score: number;
    origin: MatchOrigin;
  }>();

  for (const em of existingMatches || []) {
    existingMap.set(em.property_id, em);
  }

  // Identifica se o lead veio de um anúncio CTWA mapeado a um imóvel específico
  const { data: conv } = await db
    .from('conversations')
    .select('ctwa_referral, property_id')
    .eq('contact_id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  const ctwaPropertyId = conv?.property_id || null;

  let matchesCount = 0;
  let strongMatchesCount = 0;
  const newStrongMatchesToNotify: { propertyTitle: string; score: number }[] = [];

  for (const prop of properties) {
    const existing = existingMap.get(prop.propertyId);

    // REGRA DE SUPRESSÃO (FASE 11): se já foi descartado pelo corretor, NUNCA recalcula/reinsere
    if (existing?.suppressed) {
      continue;
    }

    const evaluation = evaluateMatch(profile, prop);

    // Se eliminado por critério eliminatório, verifica se já existia match e não recria
    if (!evaluation.eligible) {
      continue;
    }

    const priority = calculateCommercialPriority({
      matchScore: evaluation.matchScore,
      aiScore: profile.aiScore,
      profileMaturity: maturityEval.maturity,
    });

    const isCtwaOrigin = ctwaPropertyId === prop.propertyId;
    const origin: MatchOrigin = isCtwaOrigin
      ? 'origem_ctwa'
      : existing?.origin || 'match_automatico';

    // Preserva o estado se já estava 'enviado', 'pausado' ou 'arquivado'
    const matchStatus: MatchStatus = existing?.match_status || 'novo';

    const { error: upsertErr } = await db.from('lead_property_matches').upsert(
      {
        account_id: accountId,
        lead_id: contactId,
        property_id: prop.propertyId,
        match_score: evaluation.matchScore,
        score_breakdown: evaluation.scoreBreakdown,
        profile_maturity: maturityEval.maturity,
        commercial_priority: priority,
        match_status: matchStatus,
        suppressed: false,
        origin,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,lead_id,property_id' }
    );

    if (!upsertErr) {
      matchesCount++;
      if (evaluation.isStrongMatch) {
        strongMatchesCount++;
        // Só notifica se for novo match forte, a maturidade estiver >= 70% e NÃO for a origem do CTWA
        if (
          maturityEval.meetsThreshold &&
          !isCtwaOrigin &&
          (!existing || existing.match_score < 85)
        ) {
          newStrongMatchesToNotify.push({
            propertyTitle: prop.title,
            score: evaluation.matchScore,
          });
        }
      }
    }
  }

  // Notificação push para novos Matches fortes (FASE 18)
  if (newStrongMatchesToNotify.length > 0) {
    try {
      const count = newStrongMatchesToNotify.length;
      const body =
        count === 1
          ? `${profile.name} agora possui Match forte (${newStrongMatchesToNotify[0].score}%) com ${newStrongMatchesToNotify[0].propertyTitle}.`
          : `${profile.name} agora possui ${count} Matches fortes de imóveis!`;

      await sendPushToAccount(accountId, {
        title: 'Novo Match Forte 🎯',
        body,
        url: `/match?lead=${contactId}`,
        tag: `match-strong-${contactId}`,
      });
    } catch (err) {
      console.error('[match-service] Erro ao enviar notificação de Match:', err);
    }
  }

  return {
    leadId: contactId,
    maturity: maturityEval.maturity,
    meetsThreshold: maturityEval.meetsThreshold,
    totalPropertiesEvaluated: properties.length,
    matchesCreatedOrUpdated: matchesCount,
    strongMatchesCount,
  };
}

/**
 * Recalcula Matches quando um imóvel é cadastrado ou atualizado no catálogo.
 * Suporta notificação consolidada caso gere múltiplos Matches fortes (FASE 18).
 */
export async function recalculateMatchesForProperty(
  db: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<{ totalLeadsEvaluated: number; strongMatchesCount: number }> {
  // Busca a projeção do imóvel
  const { data: propRow, error: pErr } = await db
    .from('property_match_projections')
    .select('*')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .maybeSingle();

  if (pErr || !propRow || propRow.status !== 'ativo') {
    // Quando o imóvel fica indisponível (vendido, arquivado, inativo ou excluído),
    // remove os matches pendentes ('novo') para que deixem de aparecer como opções para envio.
    await db
      .from('lead_property_matches')
      .delete()
      .eq('account_id', accountId)
      .eq('property_id', propertyId)
      .eq('match_status', 'novo');

    return { totalLeadsEvaluated: 0, strongMatchesCount: 0 };
  }

  const property: PropertyProjection = {
    id: propRow.id,
    propertyId: propRow.property_id,
    accountId: propRow.account_id,
    code: propRow.code,
    title: propRow.title,
    operation: propRow.operation,
    propertyType: propRow.property_type,
    neighborhood: propRow.neighborhood,
    city: propRow.city,
    priceMin: Number(propRow.price_min),
    priceMax: Number(propRow.price_max),
    areaMin: propRow.area_min ? Number(propRow.area_min) : null,
    areaMax: propRow.area_max ? Number(propRow.area_max) : null,
    bedroomsMin: propRow.bedrooms_min,
    bedroomsMax: propRow.bedrooms_max,
    deliveryStatus: propRow.delivery_status,
    deliveryDeadline: propRow.delivery_deadline,
    features: propRow.features || [],
    coverUrl: propRow.cover_url,
    publicUrl: propRow.public_url,
    status: propRow.status,
  };

  // Busca leads ativos (não pausados e não arquivados)
  const { data: activeContacts } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .is('paused_at', null)
    .is('archived_at', null);

  let strongMatchesCount = 0;
  let evaluated = 0;

  for (const c of activeContacts || []) {
    const profile = await buildLeadSearchProfile(db, accountId, c.id);
    if (!profile) continue;

    const maturityEval = calculateProfileMaturity(profile);
    // Desconsidera leads totalmente vazios (sem nenhuma informação extraída na conversa ou tags)
    if (maturityEval.maturity < 20) continue;

    // Checa supressão prévia
    const { data: existing } = await db
      .from('lead_property_matches')
      .select('id, suppressed, match_status, origin')
      .eq('account_id', accountId)
      .eq('lead_id', c.id)
      .eq('property_id', propertyId)
      .maybeSingle();

    if (existing?.suppressed) continue;

    const evaluation = evaluateMatch(profile, property);
    if (!evaluation.eligible) continue;

    evaluated++;
    const priority = calculateCommercialPriority({
      matchScore: evaluation.matchScore,
      aiScore: profile.aiScore,
      profileMaturity: maturityEval.maturity,
    });

    const matchStatus: MatchStatus = existing?.match_status || 'novo';
    const origin: MatchOrigin = existing?.origin || 'match_automatico';

    await db.from('lead_property_matches').upsert(
      {
        account_id: accountId,
        lead_id: c.id,
        property_id: propertyId,
        match_score: evaluation.matchScore,
        score_breakdown: evaluation.scoreBreakdown,
        profile_maturity: maturityEval.maturity,
        commercial_priority: priority,
        match_status: matchStatus,
        suppressed: false,
        origin,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,lead_id,property_id' }
    );

    if (evaluation.isStrongMatch && maturityEval.meetsThreshold) {
      strongMatchesCount++;
    }
  }

  // FASE 18: Notificação CONSOLIDADA para imóvel novo/atualizado
  if (strongMatchesCount > 0) {
    try {
      const body =
        strongMatchesCount === 1
          ? `${property.title} gerou 1 Match forte com seus leads!`
          : `${property.title} gerou ${strongMatchesCount} Matches fortes com seus leads!`;

      await sendPushToAccount(accountId, {
        title: 'Novo Imóvel com Matches Fortes 🏢',
        body,
        url: `/match?property=${propertyId}`,
        tag: `property-strong-${propertyId}`,
      });
    } catch (err) {
      console.error('[match-service] Erro ao enviar push consolidado:', err);
    }
  }

  return { totalLeadsEvaluated: evaluated, strongMatchesCount };
}

/**
 * Descarta/Suprime um Match (FASE 11: Supressão).
 * O par (lead_id, property_id) é marcado como suppressed = true.
 */
export async function suppressMatch(
  db: SupabaseClient,
  accountId: string,
  leadId: string,
  propertyId: string
): Promise<boolean> {
  const { error } = await db
    .from('lead_property_matches')
    .update({
      suppressed: true,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('lead_id', leadId)
    .eq('property_id', propertyId);

  return !error;
}

/**
 * Atualiza o status visível de um Match ('novo' | 'enviado' | 'pausado' | 'arquivado').
 */
export async function updateMatchStatus(
  db: SupabaseClient,
  accountId: string,
  matchId: string,
  newStatus: MatchStatus
): Promise<boolean> {
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    match_status: newStatus,
    updated_at: now,
  };

  if (newStatus === 'enviado') updateData.sent_at = now;
  if (newStatus === 'pausado') updateData.paused_at = now;
  if (newStatus === 'arquivado') updateData.archived_at = now;

  const { error } = await db
    .from('lead_property_matches')
    .update(updateData)
    .eq('id', matchId)
    .eq('account_id', accountId);

  return !error;
}

/**
 * Cria um novo envio de imóvel gerando token opaco individual.
 * Transiciona imediatamente o Match para 'enviado' (FASE 14 & 15).
 */
export async function createPropertyShare(
  db: SupabaseClient,
  args: {
    accountId: string;
    leadId: string;
    propertyId: string;
    matchId?: string | null;
    messageText?: string | null;
  }
): Promise<{ share: PropertyShareRecord; publicUrl: string; waLink: string } | null> {
  const { accountId, leadId, propertyId, matchId, messageText } = args;

  // Valida que o imóvel existe e está ATIVO antes de gerar token ou link de compartilhamento
  const { data: propRow, error: propCheckErr } = await db
    .from('property_match_projections')
    .select('status')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .maybeSingle();

  if (propCheckErr || !propRow || propRow.status !== 'ativo') {
    console.warn('[createPropertyShare] Tentativa de compartilhar imóvel indisponível ou inexistente:', {
      propertyId,
      status: propRow?.status || 'inexistente',
    });
    return null;
  }

  const trackingToken = generateTrackingToken();
  const now = new Date().toISOString();

  const { data: shareRow, error: shareErr } = await db
    .from('property_shares')
    .insert({
      account_id: accountId,
      lead_id: leadId,
      property_id: propertyId,
      match_id: matchId || null,
      tracking_token: trackingToken,
      channel: 'whatsapp_pessoal',
      message_text: messageText || null,
      sent_at: now,
    })
    .select('*')
    .single();

  if (shareErr || !shareRow) {
    console.error('[match-service] Falha ao registrar property_share:', shareErr);
    return null;
  }

  // Transiciona o Match para 'enviado'
  if (matchId) {
    await updateMatchStatus(db, accountId, matchId, 'enviado');
  } else {
    // Se não tinha matchId direto, atualiza pelo par
    await db
      .from('lead_property_matches')
      .update({ match_status: 'enviado', sent_at: now, updated_at: now })
      .eq('account_id', accountId)
      .eq('lead_id', leadId)
      .eq('property_id', propertyId);
  }

  // Busca telefone do lead para montar o wa.me deep link
  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', leadId)
    .maybeSingle();

  const publicUrl = buildSharePublicUrl(trackingToken);
  const cleanPhone = (contact?.phone || '').replace(/\D/g, '');
  const defaultText =
    messageText ||
    'Encontrei uma opção que combina com o que você está procurando. Dá uma olhada e me diz o que achou:';
  const fullMessage = `${defaultText}\n${publicUrl}`;
  const waLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(fullMessage)}` : '';

  const shareRecord: PropertyShareRecord = {
    id: shareRow.id,
    accountId: shareRow.account_id,
    leadId: shareRow.lead_id,
    propertyId: shareRow.property_id,
    matchId: shareRow.match_id,
    trackingToken: shareRow.tracking_token,
    channel: shareRow.channel,
    messageText: shareRow.message_text,
    sentAt: shareRow.sent_at,
    firstOpenedAt: shareRow.first_opened_at,
    lastOpenedAt: shareRow.last_opened_at,
    openCount: shareRow.open_count || 0,
    isInterested: shareRow.is_interested || false,
    interestedAt: shareRow.interested_at,
    revokedAt: shareRow.revoked_at,
  };

  return { share: shareRecord, publicUrl, waLink };
}

/**
 * Registra eventos de rastreamento disparados pela página pública de Meus Imóveis.
 * Abertura de link, navegação entre imóveis correlatos e clique em "Tenho interesse" (FASE 16 & 17).
 */
export async function recordTrackingEvent(
  db: SupabaseClient,
  args: {
    trackingToken: string;
    eventName: 'public_link.opened' | 'public_related_property.opened' | 'public_interest.clicked';
    relatedPropertyId?: string | null;
    timestamp?: string;
  }
): Promise<{ success: boolean; shareId?: string; leadId?: string }> {
  const { trackingToken, eventName, relatedPropertyId, timestamp } = args;
  const eventTime = timestamp || new Date().toISOString();

  // Localiza o share correspondente
  const { data: share, error: sErr } = await db
    .from('property_shares')
    .select('id, account_id, lead_id, property_id, first_opened_at, last_opened_at, open_count, is_interested')
    .eq('tracking_token', trackingToken)
    .maybeSingle();

  if (sErr || !share) {
    console.warn('[tracking] Share token não encontrado ou inválido:', trackingToken);
    return { success: false };
  }

  // Deduplicação de recarregamento rápido (< 5 segundos para o mesmo evento de abertura)
  if (eventName === 'public_link.opened' && share.last_opened_at) {
    const diffMs = Math.abs(new Date(eventTime).getTime() - new Date(share.last_opened_at).getTime());
    if (diffMs < 5000) {
      console.log('[tracking] Evento public_link.opened ignorado por deduplicação de reload rápido (<5s)');
      return { success: true, shareId: share.id, leadId: share.lead_id };
    }
  }

  // 1. Grava exatamente 1 evento na tabela tracking_events
  await db.from('tracking_events').insert({
    account_id: share.account_id,
    share_id: share.id,
    lead_id: share.lead_id,
    property_id: relatedPropertyId || share.property_id,
    event_name: eventName,
    payload: { related_property_id: relatedPropertyId || null },
    created_at: eventTime,
  });

  // 2. Atualiza agregados no property_shares
  const isFirst = !share.first_opened_at;
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (eventName === 'public_link.opened' || eventName === 'public_related_property.opened') {
    updates.last_opened_at = eventTime;
    updates.open_count = (share.open_count || 0) + 1;
    if (isFirst) {
      updates.first_opened_at = eventTime;
    }
  } else if (eventName === 'public_interest.clicked') {
    updates.is_interested = true;
    updates.interested_at = eventTime;
  }

  await db.from('property_shares').update(updates).eq('id', share.id);

  // 3. Notificação especial para "Tenho interesse" (FASE 17 & 18) - apenas no primeiro clique
  if (eventName === 'public_interest.clicked' && !share.is_interested) {
    try {
      const [{ data: lead }, { data: prop }] = await Promise.all([
        db.from('contacts').select('name').eq('id', share.lead_id).maybeSingle(),
        db.from('property_match_projections').select('title').eq('property_id', share.property_id).maybeSingle(),
      ]);

      const leadName = lead?.name || 'Cliente';
      const propTitle = prop?.title || 'Imóvel';

      await sendPushToAccount(share.account_id, {
        title: '🔥 Tenho Interesse!',
        body: `${leadName} clicou em "Tenho interesse" no imóvel ${propTitle}!`,
        url: `/match?lead=${share.lead_id}`,
        tag: `interest-${share.id}`,
      });
    } catch (err) {
      console.error('[tracking] Falha ao enviar notificação de interesse:', err);
    }
  }

  return { success: true, shareId: share.id, leadId: share.lead_id };
}
