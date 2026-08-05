// ============================================================
// GET /api/track — beacon de atribución anónimo (DAD §2.2/§6).
//
// Lo dispara god.js con navigator.sendBeacon desde clicks a
// wa.me/tel: y scroll depth en la landing. Sin auth (anónimo):
// solo datos de comportamiento + ref_code opaco, nunca PII
// (DAD §9.4 — sin PII en URLs; el ref_code no contiene teléfono).
//
// Inserta un tracking_events con event_type whatsapp_click/
// phone_click/scroll_depth y el account_id resuelto server-side.
// Dedup por event_id cuando lo provee god.js.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { beaconSchema } from '@/lib/analytics/track-event-schema';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveLandingAccountId } from '@/lib/analytics/landing-account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * Best-effort client IP (mismo patrón que peek/route.ts y events/route.ts).
 * x-forwarded-for lo fija el reverse proxy; la entrada más a la izquierda
 * es el cliente original.
 */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

export async function GET(req: NextRequest) {
  // Rate-limit por IP (P0-2, auditoría fork): antes esto era un endpoint
  // anónimo con service-role y sin tope → abuso de costos/almacenamiento.
  const ip = getClientIp(req);
  const limit = checkRateLimit(`track:${ip}`, RATE_LIMITS.trackingPublic);
  if (!limit.success) return rateLimitResponse(limit);

  const url = new URL(req.url);
  const parsed = beaconSchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    ref: url.searchParams.get('ref') ?? undefined,
    landing: url.searchParams.get('landing') ?? undefined,
    event_id: url.searchParams.get('event_id') ?? undefined,
    href: url.searchParams.get('href') ?? undefined,
    scrollPercent: url.searchParams.get('scrollPercent')
      ? Number(url.searchParams.get('scrollPercent'))
      : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { type, ref, landing, event_id, href, scrollPercent } = parsed.data;

  const account_id = await resolveLandingAccountId();
  if (!account_id) {
    return NextResponse.json({ error: 'no account' }, { status: 500 });
  }

  const eventType =
    type === 'whatsapp'
      ? 'whatsapp_click'
      : type === 'phone'
        ? 'phone_click'
        : 'scroll_depth';

  const payload =
    type === 'scroll' ? { scrollPercent } : href ? { href } : null;

  const { error } = await supabaseAdmin()
    .from('tracking_events')
    .upsert(
      {
        account_id,
        event_type: eventType,
        event_id: event_id || undefined,
        ref_code: ref || null,
        landing_slug: landing || null,
        payload,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      },
      // Dedup hard: event_id UNIQUE → los reintentos con el mismo id no duplican
      { onConflict: 'event_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('[api/track] insert error:', error);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
