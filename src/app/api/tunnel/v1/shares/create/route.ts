import { NextResponse } from 'next/server';
import { authenticateTunnelRequest } from '@/lib/tunnel/auth';
import { createPropertyShare } from '@/lib/match/service';

export async function POST(request: Request) {
  const ctx = await authenticateTunnelRequest(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Não autorizado no túnel' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    lead_id?: string;
    property_id?: string;
    match_id?: string | null;
    message_text?: string | null;
  } | null;

  if (!body?.lead_id || !body?.property_id) {
    return NextResponse.json(
      { error: 'lead_id e property_id são obrigatórios' },
      { status: 400 }
    );
  }

  const { db, accountId } = ctx;
  const result = await createPropertyShare(db, {
    accountId,
    leadId: body.lead_id,
    propertyId: body.property_id,
    matchId: body.match_id || null,
    messageText: body.message_text || null,
  });

  if (!result) {
    return NextResponse.json(
      { error: 'Imóvel indisponível para envio (vendido, arquivado ou inativo) ou falha ao gerar token' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    share: result.share,
    publicUrl: result.publicUrl,
    waLink: result.waLink,
  });
}
