import { NextResponse } from 'next/server';
import { authenticateTunnelRequest, ensurePropertyUuid } from '@/lib/tunnel/auth';

export async function GET(request: Request) {
  const ctx = await authenticateTunnelRequest(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Não autorizado no túnel' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawPropertyId = searchParams.get('property_id');
  const minScore = parseInt(searchParams.get('min_score') || '50', 10);
  const minMaturity = parseInt(searchParams.get('min_maturity') || '40', 10);
  const onlyActive = searchParams.get('only_active') !== 'false';

  if (!rawPropertyId) {
    return NextResponse.json({ error: 'property_id é obrigatório' }, { status: 400 });
  }

  const propertyId = ensurePropertyUuid(rawPropertyId);
  const { db, accountId } = ctx;

  // 1. Verifica se o imóvel existe e está ativo em property_match_projections para esta conta
  const { data: propRow, error: propErr } = await db
    .from('property_match_projections')
    .select('property_id, status')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .maybeSingle();

  if (propErr) {
    console.error('[GET /api/tunnel/v1/leads/compatible] Erro ao verificar projeção:', propErr);
    return NextResponse.json({ error: 'Erro ao verificar imóvel' }, { status: 500 });
  }

  if (!propRow || propRow.status !== 'ativo') {
    // Se o imóvel não existe na conta ou não está ativo (vendido, arquivado ou inativo),
    // limpa matches pendentes para que não sejam opções de envio e retorna lista vazia
    void db
      .from('lead_property_matches')
      .delete()
      .eq('account_id', accountId)
      .eq('property_id', propertyId)
      .eq('match_status', 'novo');

    return NextResponse.json({
      property_id: rawPropertyId,
      canonical_property_id: propertyId,
      total_compatible: 0,
      leads: [],
    });
  }

  let query = db
    .from('lead_property_matches')
    .select(`
      id,
      lead_id,
      property_id,
      match_score,
      profile_maturity,
      commercial_priority,
      match_status,
      suppressed,
      contacts!inner (
        id,
        name,
        phone,
        ai_score,
        paused_at,
        archived_at
      )
    `)
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .eq('suppressed', false)
    .gte('match_score', minScore);

  if (onlyActive) {
    query = query
      .is('contacts.paused_at', null)
      .is('contacts.archived_at', null)
      .gte('profile_maturity', minMaturity);
  }

  query = query.order('commercial_priority', { ascending: false });

  const { data: matches, error } = await query;

  if (error) {
    console.error('[GET /api/tunnel/v1/leads/compatible] Erro ao buscar compatibilidades:', error);
    return NextResponse.json({ error: 'Erro ao consultar compatibilidades' }, { status: 500 });
  }

  const formattedLeads = (matches || []).map((m: Record<string, unknown>) => {
    const contact = m.contacts as { id: string; name: string | null; phone: string; ai_score: number | null };
    const leadName = contact?.name || 'Cliente';
    const initials = leadName
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    return {
      lead_id: m.lead_id,
      lead_name: leadName,
      lead_initials: initials,
      match_score: m.match_score,
      profile_maturity: m.profile_maturity,
      ai_score: contact?.ai_score ?? 0,
      commercial_priority: m.commercial_priority,
      status: 'active',
      match_status: m.match_status,
    };
  });

  return NextResponse.json({
    property_id: propertyId,
    total_compatible: formattedLeads.length,
    leads: formattedLeads,
  });
}
