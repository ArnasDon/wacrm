import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || 'novo';
    const minScore = parseInt(searchParams.get('min_score') || '0', 10);
    const maxScore = parseInt(searchParams.get('max_score') || '100', 10);
    const minMaturity = parseInt(searchParams.get('min_maturity') || '0', 10);
    const minAiScore = parseInt(searchParams.get('min_ai_score') || '0', 10);
    const leadSearch = (searchParams.get('lead_search') || '').trim();
    const propertySearch = (searchParams.get('property_search') || '').trim();

    // 1. Projeções válidas na mesma conta
    const { data: allProjections } = await ctx.supabase
      .from('property_match_projections')
      .select('property_id, status')
      .eq('account_id', ctx.accountId);
    const validPropertyIds = new Set((allProjections || []).map((p) => p.property_id));
    const activePropertyIds = new Set(
      (allProjections || []).filter((p) => p.status === 'ativo').map((p) => p.property_id)
    );

    // Contadores para cada aba de status (contando LEADS ÚNICOS de matches com projeção válida)
    const [
      { data: distinctNovos },
      { data: distinctEnviados },
      { data: distinctPausados },
      { data: distinctArquivados },
    ] = await Promise.all([
      ctx.supabase
        .from('lead_property_matches')
        .select('lead_id, property_id')
        .eq('account_id', ctx.accountId)
        .eq('match_status', 'novo')
        .eq('suppressed', false),
      ctx.supabase
        .from('lead_property_matches')
        .select('lead_id, property_id')
        .eq('account_id', ctx.accountId)
        .eq('match_status', 'enviado')
        .eq('suppressed', false),
      ctx.supabase
        .from('lead_property_matches')
        .select('lead_id, property_id')
        .eq('account_id', ctx.accountId)
        .eq('match_status', 'pausado')
        .eq('suppressed', false),
      ctx.supabase
        .from('lead_property_matches')
        .select('lead_id, property_id')
        .eq('account_id', ctx.accountId)
        .eq('match_status', 'arquivado')
        .eq('suppressed', false),
    ]);

    // Elimina eventuais órfãos encontrados nos contadores
    const allMatchesRaw = [
      ...(distinctNovos || []),
      ...(distinctEnviados || []),
      ...(distinctPausados || []),
      ...(distinctArquivados || []),
    ];
    const orphanPropertyIds = allMatchesRaw
      .filter((r) => !validPropertyIds.has(r.property_id))
      .map((r) => r.property_id);
    if (orphanPropertyIds.length > 0) {
      void ctx.supabase
        .from('lead_property_matches')
        .delete()
        .eq('account_id', ctx.accountId)
        .in('property_id', [...new Set(orphanPropertyIds)]);
    }

    // Limpa matches 'novo' associados a imóveis indisponíveis (inativo, arquivado ou esgotado)
    const staleNovoPropertyIds = (distinctNovos || [])
      .filter((r) => !activePropertyIds.has(r.property_id))
      .map((r) => r.property_id);
    if (staleNovoPropertyIds.length > 0) {
      void ctx.supabase
        .from('lead_property_matches')
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('match_status', 'novo')
        .in('property_id', [...new Set(staleNovoPropertyIds)]);
    }

    const countNovos = new Set(
      distinctNovos?.filter((r) => activePropertyIds.has(r.property_id)).map((r) => r.lead_id)
    ).size;
    const countEnviados = new Set(
      distinctEnviados?.filter((r) => validPropertyIds.has(r.property_id)).map((r) => r.lead_id)
    ).size;
    const countPausados = new Set(
      distinctPausados?.filter((r) => validPropertyIds.has(r.property_id)).map((r) => r.lead_id)
    ).size;
    const countArquivados = new Set(
      distinctArquivados?.filter((r) => validPropertyIds.has(r.property_id)).map((r) => r.lead_id)
    ).size;

    // 2. Query dos Matches no status selecionado
    let query = ctx.supabase
      .from('lead_property_matches')
      .select(`
        id,
        account_id,
        lead_id,
        property_id,
        match_score,
        score_breakdown,
        profile_maturity,
        commercial_priority,
        match_status,
        suppressed,
        origin,
        sent_at,
        paused_at,
        archived_at,
        created_at,
        updated_at,
        contacts!inner (
          id,
          name,
          phone,
          ai_score,
          ai_score_reason,
          paused_at,
          archived_at,
          has_purchased,
          is_personal_whatsapp
        )
      `)
      .eq('account_id', ctx.accountId)
      .eq('match_status', status)
      .eq('suppressed', false)
      .gte('match_score', minScore)
      .lte('match_score', maxScore)
      .gte('profile_maturity', minMaturity);

    if (minAiScore > 0) {
      query = query.gte('contacts.ai_score', minAiScore);
    }

    if (leadSearch) {
      query = query.or(`name.ilike.%${leadSearch}%,phone.ilike.%${leadSearch}%`, {
        foreignTable: 'contacts',
      });
    }

    // Ordenação interna por prioridade comercial, score de match e recência
    query = query
      .order('commercial_priority', { ascending: false })
      .order('match_score', { ascending: false })
      .order('updated_at', { ascending: false });

    const { data: matches, error } = await query;

    if (error) {
      console.error('[GET /api/match] Erro na busca de matches:', error);
      return NextResponse.json({ error: 'Falha ao buscar matches' }, { status: 500 });
    }

    // Busca os imóveis correspondentes em property_match_projections
    const propertyIds = [...new Set((matches || []).map((m) => m.property_id))];
    const propertiesMap = new Map<string, Record<string, unknown>>();

    if (propertyIds.length > 0) {
      const { data: props } = await ctx.supabase
        .from('property_match_projections')
        .select('*')
        .eq('account_id', ctx.accountId)
        .in('property_id', propertyIds);

      for (const p of props || []) {
        propertiesMap.set(p.property_id, p);
      }
    }

    // Limpa do banco de dados qualquer match órfão que não possua imóvel correspondente
    // ou match 'novo' de imóvel não ativo
    const staleMatches = (matches || []).filter((m) => {
      const prop = propertiesMap.get(m.property_id);
      if (!prop) return true;
      if (m.match_status === 'novo' && prop.status !== 'ativo') return true;
      return false;
    });
    if (staleMatches.length > 0) {
      const staleIds = staleMatches.map((m) => m.id);
      void ctx.supabase.from('lead_property_matches').delete().in('id', staleIds);
    }

    // Filtra estritamente apenas matches cujo imóvel existe na conta e, para 'novo', está ativo
    let filteredMatches = (matches || []).filter((m) => {
      const prop = propertiesMap.get(m.property_id);
      if (!prop) return false;
      if (status === 'novo' && prop.status !== 'ativo') return false;
      return true;
    });

    // Filtro por imóvel (caso fornecido)
    if (propertySearch) {
      const normSearch = propertySearch.toLowerCase();
      filteredMatches = filteredMatches.filter((m) => {
        const prop = propertiesMap.get(m.property_id);
        if (!prop) return false;
        const title = String(prop.title || '').toLowerCase();
        const neighborhood = String(prop.neighborhood || '').toLowerCase();
        const code = String(prop.code || '').toLowerCase();
        return (
          title.includes(normSearch) ||
          neighborhood.includes(normSearch) ||
          code.includes(normSearch)
        );
      });
    }

    // Anexa os dados do imóvel em cada match
    const enrichedMatches = filteredMatches.map((m) => {
      const prop = propertiesMap.get(m.property_id)!;
      return {
        ...m,
        property: {
          propertyId: prop.property_id,
          title: prop.title,
          code: prop.code,
          neighborhood: prop.neighborhood,
          city: prop.city,
          priceMin: Number(prop.price_min),
          priceMax: Number(prop.price_max),
          bedroomsMin: prop.bedrooms_min,
          bedroomsMax: prop.bedrooms_max,
          deliveryStatus: prop.delivery_status,
          coverUrl: prop.cover_url,
          publicUrl: prop.public_url,
          features: prop.features || [],
        },
      };
    });

    // 3. Agrupa os matches por LEAD (1 Card Visual = 1 Lead)
    const groupsMap = new Map<string, {
      leadId: string;
      lead: Record<string, unknown>;
      profileMaturity: number;
      aiScore: number;
      matches: typeof enrichedMatches;
    }>();

    for (const m of enrichedMatches) {
      const contactObj = (Array.isArray(m.contacts) ? m.contacts[0] : m.contacts) as Record<string, unknown>;
      if (!groupsMap.has(m.lead_id)) {
        groupsMap.set(m.lead_id, {
          leadId: m.lead_id,
          lead: contactObj,
          profileMaturity: m.profile_maturity,
          aiScore: (contactObj?.ai_score as number) ?? 0,
          matches: [],
        });
      }
      groupsMap.get(m.lead_id)!.matches.push(m);
    }

    // Busca o total de matches não suprimidos de cada lead na conta para badge
    const leadIds = [...groupsMap.keys()];
    const totalMatchesByLead: Record<string, number> = {};
    if (leadIds.length > 0) {
      const { data: totalCounts } = await ctx.supabase
        .from('lead_property_matches')
        .select('lead_id, property_id')
        .eq('account_id', ctx.accountId)
        .eq('suppressed', false)
        .in('lead_id', leadIds);

      for (const row of totalCounts || []) {
        if (validPropertyIds.has(row.property_id)) {
          totalMatchesByLead[row.lead_id] = (totalMatchesByLead[row.lead_id] || 0) + 1;
        }
      }
    }

    const groups = Array.from(groupsMap.values()).map((g) => {
      // Ordena os matches do lead: match_score DESC, depois commercial_priority DESC
      const sortedMatches = [...g.matches].sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        return b.commercial_priority - a.commercial_priority;
      });

      return {
        leadId: g.leadId,
        lead: g.lead,
        profileMaturity: g.profileMaturity,
        aiScore: g.aiScore,
        bestMatch: sortedMatches[0],
        totalMatches: totalMatchesByLead[g.leadId] || sortedMatches.length,
        statusMatchesCount: sortedMatches.length,
        matches: sortedMatches,
      };
    });

    // Ordena os grupos: melhor match_score primeiro, desempate por prioridade comercial
    groups.sort((a, b) => {
      const scoreDiff = (b.bestMatch?.match_score || 0) - (a.bestMatch?.match_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.bestMatch?.commercial_priority || 0) - (a.bestMatch?.commercial_priority || 0);
    });

    return NextResponse.json({
      counts: {
        novos: countNovos ?? 0,
        enviados: countEnviados ?? 0,
        pausados: countPausados ?? 0,
        arquivados: countArquivados ?? 0,
      },
      groups,
      matches: enrichedMatches,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
