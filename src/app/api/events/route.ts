// ============================================================
// POST /api/events — enrutador de eventos de tracking (REDUCIDO v8).
//
// Acepta solo eventos SIN hogar (DAD §4): form_submit, ctwa_lead,
// page_view, whatsapp_click, phone_click, scroll_depth. Los eventos
// nativos viven en sus tablas; los internos (state_changed/
// score_changed) solo los escribe RPC/trigger. La lista viva, con quién
// produce cada tipo, está en EVENT_TYPES (track-event-schema.ts).
//
// form_submit crea el lead reutilizando el ingest existente
// (findOrCreateContact — DAD §3.2 "reutilizar el ingest existente"),
// PERO server-side con service role: la API key de /api/v1/contacts
// NUNCA se expone al navegador. El contact lleva la atribución del
// evento (hidden fields rellenados por god.js).
//
// Dedup hard: event_id es UNIQUE → ON CONFLICT DO NOTHING; reintentos
// con el mismo event_id devuelven 202 idempotente sin duplicar.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { trackEventSchema } from '@/lib/analytics/track-event-schema';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveLandingAccountId } from '@/lib/analytics/landing-account';
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * Best-effort client IP (mismo patrón que peek/route.ts). Los reverse
 * proxies (Vercel, Hostinger, Cloudflare) fijan x-forwarded-for; tomamos
 * la entrada más a la izquierda (el cliente original). Fallback constante
 * para dev local → la llave existe y el límite aplica "global".
 */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

export async function POST(req: NextRequest) {
  // Rate-limit por IP ANTES de tocar la BD: pincha bots que spamean
  // leads falsos vía service-role (P0-2, auditoría fork).
  const ip = getClientIp(req);
  const beaconLimit = checkRateLimit(
    `events:${ip}`,
    RATE_LIMITS.trackingPublic
  );
  if (!beaconLimit.success) return rateLimitResponse(beaconLimit);

  const body = await req.json().catch(() => null);
  const parsed = trackEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { event_id, event_type, attribution, payload, ref_code, landing_slug } =
    parsed.data;

  const account_id = await resolveLandingAccountId();
  if (!account_id) {
    return NextResponse.json({ error: 'no account' }, { status: 500 });
  }

  // form_submit → find-or-create lead (reutiliza el ingest de /api/v1/contacts,
  // server-side con service role; la atribución viaja en el payload/attribution).
  if (event_type === 'form_submit') {
    // Bucket más estrecho: cada hit crea un lead + puede disparar
    // automatizaciones de WhatsApp pagadas.
    const formLimit = checkRateLimit(
      `events:${ip}:form`,
      RATE_LIMITS.trackingFormSubmit
    );
    if (!formLimit.success) return rateLimitResponse(formLimit);

    const phone =
      typeof payload?.phone === 'string' ? payload.phone.trim() : '';
    if (!phone) {
      return NextResponse.json(
        { error: "'payload.phone' is required for form_submit" },
        { status: 400 }
      );
    }
    const admin = supabaseAdmin();
    const auditUserId = await resolveAuditUserId(admin, account_id);
    try {
      await findOrCreateContact(admin, account_id, auditUserId, {
        phone,
        name: typeof payload?.name === 'string' ? payload.name : undefined,
        email: typeof payload?.email === 'string' ? payload.email : undefined,
        // El eslabón que faltaba: la atribución ya estaba aquí y solo se
        // escribía en `tracking_events`, así que el contacto nacía sin origen
        // y los informes de adquisición agregaban sobre NULL. Se escribe solo
        // al crear (primer contacto gana); si el contacto ya existía,
        // findOrCreateContact la ignora.
        attribution: attribution ?? null,
      });
    } catch (err) {
      console.error('[api/events] findOrCreateContact error:', err);
      return NextResponse.json({ error: 'lead_failed' }, { status: 500 });
    }
  }

  const { error } = await supabaseAdmin()
    .from('tracking_events')
    .upsert(
      {
        account_id,
        event_id,
        event_type,
        attribution: attribution ?? null,
        payload: payload ?? null,
        ref_code: ref_code ?? null,
        landing_slug: landing_slug ?? null,
      },
      // Dedup hard: event_id UNIQUE → los reintentos con el mismo id no duplican
      { onConflict: 'event_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('[api/events] insert error:', error);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
