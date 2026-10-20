import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buildLeadSearchProfile } from '@/lib/match/profile-builder';
import { calculateProfileMaturity } from '@/lib/match/maturity';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const profile = await buildLeadSearchProfile(ctx.supabase, ctx.accountId, contactId);
    if (!profile) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 });
    }

    const maturity = calculateProfileMaturity(profile);

    const { data: contactRow } = await ctx.supabase
      .from('contacts')
      .select('has_purchased')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const hasPurchased = Boolean(contactRow?.has_purchased);

    // 1. Busca os imóveis enviados a este lead
    const { data: shares } = await ctx.supabase
      .from('property_shares')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('lead_id', contactId)
      .order('sent_at', { ascending: false });

    // 2. Busca dados dos imóveis referenciados nos shares
    const propIds = [...new Set((shares || []).map((s) => s.property_id))];
  const propertyMap = new Map<string, { title: string; neighborhood: string; coverUrl?: string }>();
    if (propIds.length > 0) {
      const { data: props } = await ctx.supabase
        .from('property_match_projections')
        .select('property_id, title, neighborhood, cover_url')
        .eq('account_id', ctx.accountId)
        .in('property_id', propIds);

      for (const p of props || []) {
        propertyMap.set(p.property_id, {
          title: p.title,
          neighborhood: p.neighborhood,
          coverUrl: p.cover_url,
        });
      }
    }

    const enrichedShares = (shares || []).map((s) => {
      const p = propertyMap.get(s.property_id);
      return {
        id: s.id,
        propertyId: s.property_id,
        propertyTitle: p?.title || 'Imóvel em Catálogo',
        propertyNeighborhood: p?.neighborhood || 'João Pessoa',
        propertyCoverUrl: p?.coverUrl || null,
        sentAt: s.sent_at,
        firstOpenedAt: s.first_opened_at,
        lastOpenedAt: s.last_opened_at,
        openCount: s.open_count || 0,
        isInterested: s.is_interested || false,
        interestedAt: s.interested_at,
      };
    });

    // 3. Busca tags com proveniência
    const { data: contactTags } = await ctx.supabase
      .from('contact_tags')
      .select('source, originally_from_ctwa, tags(id, name, color, category)')
      .eq('contact_id', contactId);

    const mappedTags = (contactTags || [])
      .filter((ct: Record<string, unknown>) => ct.tags)
      .map((ct: Record<string, unknown>) => {
        const t = ct.tags as { id: string; name: string; color: string; category?: string };
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          category: t.category,
          source: (ct.source as string) || 'conversation',
          originallyFromCtwa: (ct.originally_from_ctwa as boolean) || false,
        };
      });

    // 4. Busca os matches não suprimidos deste lead para o workspace comercial
    const { data: leadMatches } = await ctx.supabase
      .from('lead_property_matches')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('lead_id', contactId)
      .eq('suppressed', false)
      .order('match_score', { ascending: false })
      .order('commercial_priority', { ascending: false });

    // Busca os dados completos de projeção dos imóveis compatíveis
    const matchPropIds = [...new Set((leadMatches || []).map((m) => m.property_id))];
    const matchPropertiesMap = new Map<string, Record<string, unknown>>();
    if (matchPropIds.length > 0) {
      let mPropsQuery = ctx.supabase
        .from('property_match_projections')
        .select('*')
        .eq('account_id', ctx.accountId);

      if (matchPropIds.length <= 50) {
        mPropsQuery = mPropsQuery.in('property_id', matchPropIds);
      }

      const { data: mProps, error: mPropsErr } = await mPropsQuery;

      if (!mPropsErr && mProps) {
        for (const p of mProps) {
          matchPropertiesMap.set(p.property_id, p);
        }
      }
    }

    // Limpa do banco de dados qualquer match órfão que não possua projeção ou match 'novo' de imóvel indisponível
    // APENAS se matchPropertiesMap foi carregado com sucesso para não expurgar por falha transitória
    if (matchPropertiesMap.size > 0) {
      const orphanOrInactiveMatchIds = (leadMatches || [])
        .filter((m) => {
          const prop = matchPropertiesMap.get(m.property_id);
          if (!prop) return true;
          if (m.match_status === 'novo' && prop.status !== 'ativo') return true;
          return false;
        })
        .map((m) => m.id);
      if (orphanOrInactiveMatchIds.length > 0) {
        void ctx.supabase.from('lead_property_matches').delete().in('id', orphanOrInactiveMatchIds);
      }
    }

    const enrichedMatches = (leadMatches || [])
      .filter((m) => {
        const prop = matchPropertiesMap.get(m.property_id);
        if (!prop) return false;
        if (m.match_status === 'novo' && prop.status !== 'ativo') return false;
        return true;
      })
      .map((m) => {
        const prop = matchPropertiesMap.get(m.property_id)!;
        return {
          ...m,
          contacts: {
            id: profile.leadId,
            name: profile.name,
            phone: profile.phone,
            ai_score: profile.aiScore,
            is_paused: profile.isPaused,
            is_archived: profile.isArchived,
            has_purchased: hasPurchased,
          },
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
            areaMin: prop.area_min,
            areaMax: prop.area_max,
            deliveryStatus: prop.delivery_status,
            coverUrl: prop.cover_url,
            publicUrl: prop.public_url,
            features: prop.features || [],
          },
        };
      });

    // Ordenação garantida: match_score DESC, depois prioridade comercial DESC
    enrichedMatches.sort((a, b) => {
      if (b.match_score !== a.match_score) return b.match_score - a.match_score;
      return (b.commercial_priority || 0) - (a.commercial_priority || 0);
    });

    const matchGroup = {
      leadId: profile.leadId,
      lead: {
        id: profile.leadId,
        name: profile.name,
        phone: profile.phone,
        aiScore: profile.aiScore,
        ai_score: profile.aiScore,
        paused_at: profile.isPaused ? new Date().toISOString() : null,
        archived_at: profile.isArchived ? new Date().toISOString() : null,
        has_purchased: hasPurchased,
      },
      profileMaturity: maturity.maturity,
      aiScore: profile.aiScore,
      bestMatch: enrichedMatches[0] || null,
      totalMatches: enrichedMatches.length,
      statusMatchesCount: enrichedMatches.length,
      matches: enrichedMatches,
    };

    return NextResponse.json({
      lead: {
        id: profile.leadId,
        name: profile.name,
        phone: profile.phone,
        aiScore: profile.aiScore,
        isPaused: profile.isPaused,
        isArchived: profile.isArchived,
        hasPurchased,
      },
      searchProfile: {
        operation: profile.operation,
        purpose: profile.purpose,
        propertyTypes: profile.propertyTypes,
        propertyTypeStrict: profile.propertyTypeStrict,
        locations: profile.locations,
        locationStrict: profile.locationStrict,
        priceMin: profile.priceMin,
        priceMax: profile.priceMax,
        priceStrictMax: profile.priceStrictMax,
        priceFlexMax: profile.priceFlexMax,
        bedrooms: profile.bedrooms,
        bedroomsStrict: profile.bedroomsStrict,
        deliveryStatus: profile.deliveryStatus,
        deliveryStrict: profile.deliveryStrict,
        requiredFeatures: profile.requiredFeatures,
        preferredFeatures: profile.preferredFeatures,
        provenance: profile.provenance,
      },
      maturity,
      tags: mappedTags,
      sentProperties: enrichedShares,
      matchGroup,
      matches: enrichedMatches,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH: Alterna status do lead entre ativo, pausado e arquivado (FASE 10 & 20).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const body = (await request.json().catch(() => null)) as {
      action?: 'pause' | 'resume' | 'archive' | 'unarchive';
    } | null;

    if (!body?.action) {
      return NextResponse.json({ error: 'action é obrigatória' }, { status: 400 });
    }

    const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

    if (body.action === 'pause') {
      updates.paused_at = now;
    } else if (body.action === 'resume') {
      updates.paused_at = null;
    } else if (body.action === 'archive') {
      updates.archived_at = now;
    } else if (body.action === 'unarchive') {
      updates.archived_at = null;
    }

    const { error } = await ctx.supabase
      .from('contacts')
      .update(updates)
      .eq('id', contactId)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[PATCH /api/match/lead/:id] Erro ao atualizar status do contato:', error);
      return NextResponse.json({ error: 'Falha ao atualizar status' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, action: body.action });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE: Exclui definitivamente o lead e todos os seus vínculos de match e dados associados.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    // 1. Verifica se o lead existe e pertence à conta
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, name')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 });
    }

    // 2. Limpa registros dependentes de match, inteligência e compartilhamentos
    await ctx.supabase
      .from('lead_property_matches')
      .delete()
      .eq('lead_id', contactId)
      .eq('account_id', ctx.accountId);

    await ctx.supabase
      .from('lead_intelligence')
      .delete()
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId);

    await ctx.supabase
      .from('property_shares')
      .delete()
      .eq('lead_id', contactId)
      .eq('account_id', ctx.accountId);

    // 3. Exclui o contato (as FKs em cascata limpam conversas, tags, etc.)
    const { error: delError } = await ctx.supabase
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('account_id', ctx.accountId);

    if (delError) {
      console.error('[DELETE /api/match/lead/:id] Erro ao excluir lead:', delError);
      return NextResponse.json(
        { error: 'Falha ao excluir lead: ' + delError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, deletedId: contactId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
