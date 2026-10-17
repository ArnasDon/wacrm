import { NextResponse } from 'next/server';
import { authenticateTunnelRequest, ensurePropertyUuid } from '@/lib/tunnel/auth';
import { recalculateMatchesForProperty } from '@/lib/match/service';

function parseNum(val: unknown, fallback: number | null = null): number | null {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const cleaned = val.replace(/[R$\s.]/g, '').replace(',', '.');
    const n = Number(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function normalizeDateString(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{2}\/\d{4}$/.test(trimmed)) {
    const [mm, yyyy] = trimmed.split('/');
    return `${yyyy}-${mm}-01`;
  }
  return null;
}

export async function POST(request: Request) {
  const ctx = await authenticateTunnelRequest(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Não autorizado no túnel' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    property_id?: string;
    code?: string;
    title?: string;
    operation?: 'venda' | 'locacao';
    property_type?: string;
    neighborhood?: string;
    city?: string;
    price_min?: number | string;
    price_max?: number | string;
    area_min?: number | string;
    area_max?: number | string;
    bedrooms_min?: number | string;
    bedrooms_max?: number | string;
    delivery_status?: 'pronto' | 'planta' | 'em_construcao';
    delivery_deadline?: string;
    features?: string[];
    cover_url?: string;
    public_url?: string;
    status?: 'ativo' | 'inativo' | 'arquivado';
  } | null;

  if (!body?.property_id || !body?.title || !body?.neighborhood) {
    return NextResponse.json(
      { error: 'property_id, title e neighborhood são obrigatórios' },
      { status: 400 }
    );
  }

  const { db, accountId } = ctx;
  const canonicalPropertyId = ensurePropertyUuid(body.property_id);
  const priceMin = parseNum(body.price_min, 0) ?? 0;
  const priceMax = parseNum(body.price_max, priceMin) ?? priceMin;

  const upsertData = {
    account_id: accountId,
    property_id: canonicalPropertyId,
    code: body.code || null,
    title: body.title.trim(),
    operation: (body.operation || 'venda').toLowerCase(),
    property_type: (body.property_type || 'apartamento').toLowerCase().trim(),
    neighborhood: body.neighborhood.trim(),
    city: (body.city || 'João Pessoa').trim(),
    price_min: priceMin,
    price_max: priceMax,
    area_min: parseNum(body.area_min, null),
    area_max: parseNum(body.area_max, null),
    bedrooms_min: parseNum(body.bedrooms_min, null),
    bedrooms_max: parseNum(body.bedrooms_max, null),
    delivery_status: body.delivery_status || 'pronto',
    delivery_deadline: normalizeDateString(body.delivery_deadline),
    features: Array.isArray(body.features) ? body.features : [],
    cover_url: body.cover_url || null,
    public_url: body.public_url || null,
    status: body.status || 'ativo',
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from('property_match_projections')
    .upsert(upsertData, { onConflict: 'account_id,property_id' });

  if (error) {
    console.error('[POST /api/tunnel/v1/properties/sync] Erro ao sincronizar imóvel:', error);
    return NextResponse.json({ error: 'Erro ao persistir projeção' }, { status: 500 });
  }

  // Recalcula os Matches para os leads ativos e elegíveis
  const recalculation = await recalculateMatchesForProperty(db, accountId, canonicalPropertyId);

  return NextResponse.json({
    success: true,
    action: 'upserted',
    property_id: canonicalPropertyId,
    matches_recalculated: recalculation.totalLeadsEvaluated,
    strong_matches_count: recalculation.strongMatchesCount,
  });
}
