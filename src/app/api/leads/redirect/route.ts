// ============================================================
// GET /api/leads/redirect
//
// Public — no auth required. This is the URL you put as the
// destination link on a Meta/Google Ads "Website"/Traffic-objective
// campaign (NOT the native "click to WhatsApp" message-ad format,
// which has no destination-URL field at all — see the redirect
// pattern's own rationale in the CRM's Settings → Organização
// help text): ?org=<organizationId>, optionally with utm_source,
// utm_medium, utm_campaign, utm_content, utm_term, email, and origin.
// Meta appends `fbclid` to this URL automatically on its own — no
// extra setup needed for that one.
//
// Picks the next seller in the organization's round-robin (see
// assign_next_seller() in 048_lead_distribution.sql), logs the lead,
// and 307-redirects the browser straight to that seller's
// https://wa.me/<number> — the same UX as a normal click-to-WhatsApp
// ad, except the destination number rotates per click instead of
// being hardcoded in the ad. If the organization has Meta Conversions
// API reporting turned on (049_meta_conversions_api.sql), also
// reports a "Lead" server event back to Meta after redirecting, so ad
// delivery can optimize on real leads instead of just clicks.
//
// Falls back to organizations.fallback_lead_phone when no seller is
// currently eligible (everyone paused, or nobody has set a number
// yet) — an ad link must never dead-end a real customer with an
// error page. If even that isn't configured, renders a small HTML
// page instead of a bare JSON error, since a real visitor's browser
// lands here directly.
// ============================================================

import { NextResponse, after } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveOrgMetaCapiConfig, sendMetaLeadEvent } from '@/lib/meta-capi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MESSAGE = 'Olá! Vi o anúncio e gostaria de mais informações.';

/** Same best-effort-IP shape as /api/invitations/[token]/peek. */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

function noStoreHtml(message: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;color:#222">` +
      `<p style="max-width:420px">${message}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

function waRedirect(phoneDigits: string, message: string) {
  const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
  return NextResponse.redirect(url, { status: 307, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`leadRedirect:${ip}`, RATE_LIMITS.leadRedirect);
  if (!limit.success) return rateLimitResponse(limit);

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('org')?.trim() ?? '';
  if (!UUID_RE.test(organizationId)) {
    return noStoreHtml('Link inválido — fale com a loja para conseguir um novo link.', 400);
  }

  const name = searchParams.get('name')?.trim().slice(0, 120) || null;
  const phone = searchParams.get('phone')?.trim().slice(0, 30) || null;
  const email = searchParams.get('email')?.trim().slice(0, 200) || null;
  const origin = searchParams.get('origin')?.trim().slice(0, 60) || 'meta_ads';
  const utm: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = searchParams.get(key);
    if (value) utm[key] = value.slice(0, 200);
  }

  // Meta's own click-id, appended automatically to the destination URL
  // of a Traffic/Website-objective ad (same mechanism the utm_* params
  // above rely on) — the match key the Conversions API "Lead" event
  // below uses, formatted per Meta's documented `fbc` shape. Stored in
  // the same `utm` jsonb column as the utm_* params rather than a new
  // ad_leads column, since it's the same "extra context captured at
  // click time" that column already exists for.
  const fbclid = searchParams.get('fbclid')?.trim().slice(0, 200) || null;
  const fbc = fbclid ? `fb.1.${Date.now()}.${fbclid}` : null;
  if (fbc) utm.fbc = fbc;

  const admin = supabaseAdmin();

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select(
      'id, fallback_lead_phone, lead_message_template, meta_capi_enabled, meta_capi_dataset_id, meta_capi_access_token',
    )
    .eq('id', organizationId)
    .maybeSingle();

  if (orgError) {
    console.error('[leads/redirect] error loading organization:', orgError);
    return noStoreHtml('Não foi possível processar seu contato agora. Tente novamente em instantes.', 500);
  }
  if (!org) {
    return noStoreHtml('Link inválido — fale com a loja para conseguir um novo link.', 404);
  }

  const message = org.lead_message_template?.trim() || DEFAULT_MESSAGE;

  const { data: assigned, error: assignError } = await admin.rpc('assign_next_seller', {
    p_organization_id: organizationId,
    p_lead_name: name,
    p_lead_phone: phone,
    p_origin: origin,
    p_utm: utm,
  });

  if (assignError) {
    console.error('[leads/redirect] assign_next_seller failed:', assignError);
    return noStoreHtml('Não foi possível processar seu contato agora. Tente novamente em instantes.', 500);
  }

  const row = Array.isArray(assigned) ? assigned[0] : assigned;
  const redirectPhone: string | null = row?.redirect_phone ?? null;

  // Report the lead to Meta's Conversions API, if the store has it
  // configured — scheduled with `after()` so it runs once the redirect
  // response has already been sent to the customer's browser. Never
  // let this delay (or, if Meta is down, ever block) the actual
  // WhatsApp handoff above.
  const capiConfig = resolveOrgMetaCapiConfig(org);
  if (capiConfig) {
    after(async () => {
      try {
        const result = await sendMetaLeadEvent({
          datasetId: capiConfig.datasetId,
          accessToken: capiConfig.accessToken,
          eventTime: Math.floor(Date.now() / 1000),
          phone,
          email,
          fbc,
        });
        if (!result.ok) {
          console.error(
            `[leads/redirect] Meta CAPI event failed for org ${organizationId}:`,
            result.status,
            result.body,
          );
        }
      } catch (err) {
        console.error(`[leads/redirect] Meta CAPI event threw for org ${organizationId}:`, err);
      }
    });
  }

  if (redirectPhone) {
    return waRedirect(redirectPhone, message);
  }

  // Nobody eligible right now — fall back to the store-wide number
  // rather than dead-ending the customer.
  if (org.fallback_lead_phone) {
    return waRedirect(org.fallback_lead_phone, message);
  }

  console.warn(`[leads/redirect] no eligible seller and no fallback for org ${organizationId}`);
  return noStoreHtml('No momento não conseguimos te atender por aqui. Tente novamente mais tarde.');
}
