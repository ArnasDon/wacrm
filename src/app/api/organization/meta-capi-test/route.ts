import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveOrgMetaCapiConfig, sendMetaLeadEvent } from '@/lib/meta-capi';

/**
 * POST /api/organization/meta-capi-test
 *
 * Owner-only. Sends one test "Lead" event to Meta using the
 * organization's already-saved Meta Conversions API credentials
 * (049_meta_conversions_api.sql), tagged with an optional
 * `test_event_code` (from Events Manager → Test events) so it shows
 * up under that tab instead of mixing into production data.
 *
 * Unlike the real send in leads/redirect/route.ts, this one is
 * awaited synchronously and its result returned to the caller — the
 * whole point here is to see whether it worked, not to redirect a
 * real customer.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('owner');

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, meta_capi_enabled, meta_capi_dataset_id, meta_capi_access_token')
      .eq('owner_account_id', accountId)
      .maybeSingle();

    if (orgError) {
      console.error('[organization/meta-capi-test] error loading organization:', orgError);
      return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: "You don't own an organization." }, { status: 400 });
    }

    // Test sends are allowed even while `enabled` is still off, so an
    // owner can verify credentials before flipping the switch —
    // resolveOrgMetaCapiConfig alone would refuse that.
    if (!org.meta_capi_dataset_id || !org.meta_capi_access_token) {
      return NextResponse.json(
        { error: 'Configure e salve o Dataset ID e o Access Token primeiro.' },
        { status: 400 },
      );
    }
    const config = resolveOrgMetaCapiConfig({ ...org, meta_capi_enabled: true });
    if (!config) {
      return NextResponse.json(
        { error: 'Não foi possível ler as credenciais salvas — salve o Access Token novamente.' },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const testEventCode =
      typeof body?.testEventCode === 'string' && body.testEventCode.trim()
        ? body.testEventCode.trim().slice(0, 40)
        : undefined;

    // Meta rejects an event whose user_data has zero identifiers with
    // a bare "Invalid parameter" (code 100) — a test click from this
    // Settings button has no phone/email/fbclid to offer, so these
    // two (always available from the request itself) are what keep
    // the test send valid. Real production sends get the same
    // treatment in leads/redirect/route.ts.
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      null;

    const result = await sendMetaLeadEvent({
      datasetId: config.datasetId,
      accessToken: config.accessToken,
      eventTime: Math.floor(Date.now() / 1000),
      testEventCode,
      clientIpAddress: clientIp,
      clientUserAgent: request.headers.get('user-agent'),
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Meta recusou o evento de teste.', metaResponse: result.body },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, metaResponse: result.body });
  } catch (err) {
    return toErrorResponse(err);
  }
}
