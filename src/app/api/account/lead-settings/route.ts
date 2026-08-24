import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const PHONE_DIGITS_RE = /^\d{10,15}$/;

/**
 * GET /api/account/lead-settings
 *
 * Owner-only (every account is its own tenant — "owner" here just
 * means "the person signed into this account", same as everywhere
 * else in this codebase). Returns this account's own participation
 * in ad-lead round-robin: see 048_lead_distribution.sql.
 *
 * Exists separately from PATCH /api/organization/sellers/[id]
 * because that route explicitly refuses to touch the caller's own
 * store account ("You can't edit... your own store account this
 * way") — the store owner is itself an eligible seller in the
 * rotation and needs a way to set its own WhatsApp number and pause
 * itself, same as any seller can for themselves.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('owner');

    const { data, error } = await supabase
      .from('accounts')
      .select('lead_redirect_phone, lead_rotation_enabled, last_lead_assigned_at')
      .eq('id', accountId)
      .maybeSingle();

    if (error || !data) {
      console.error('[account/lead-settings] load failed:', error);
      return NextResponse.json({ error: 'Failed to load lead settings' }, { status: 500 });
    }

    return NextResponse.json({
      leadRedirectPhone: data.lead_redirect_phone,
      leadRotationEnabled: data.lead_rotation_enabled,
      lastLeadAssignedAt: data.last_lead_assigned_at,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/account/lead-settings
 *
 * Owner-only. Sets this account's own WhatsApp redirect number and/or
 * toggles whether it currently takes a turn in the organization's
 * lead round-robin. Writes through the caller's own RLS-scoped
 * client — `accounts_update` (migration 017) already lets an
 * admin+-role member update their own account row, so no service-role
 * client is needed here (unlike the cross-account seller-editing
 * routes under /api/organization/sellers).
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');

    const limit = checkRateLimit(`account:leadSettings:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const update: Record<string, unknown> = {};

    if ('leadRedirectPhone' in body) {
      const raw = body.leadRedirectPhone;
      if (raw === null || raw === '') {
        update.lead_redirect_phone = null;
      } else if (typeof raw === 'string') {
        const digits = raw.replace(/\D/g, '');
        if (!PHONE_DIGITS_RE.test(digits)) {
          return NextResponse.json(
            { error: 'WhatsApp number must have 10 to 15 digits (country + area + number).' },
            { status: 400 },
          );
        }
        update.lead_redirect_phone = digits;
      }
    }

    if (typeof body?.leadRotationEnabled === 'boolean') {
      update.lead_rotation_enabled = body.leadRotationEnabled;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('accounts')
      .update(update)
      .eq('id', accountId)
      .select('lead_redirect_phone, lead_rotation_enabled, last_lead_assigned_at')
      .single();

    if (updateError || !updated) {
      console.error('[account/lead-settings] update failed:', updateError);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({
      leadRedirectPhone: updated.lead_redirect_phone,
      leadRotationEnabled: updated.lead_rotation_enabled,
      lastLeadAssignedAt: updated.last_lead_assigned_at,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
