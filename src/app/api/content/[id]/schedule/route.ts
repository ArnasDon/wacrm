import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  resolveAudienceContacts,
  type AudienceSelector,
} from '@/lib/content/audience';

const LANGUAGES = ['ur', 'ps', 'pa', 'ur-Roman'] as const;

/**
 * POST /api/content/[id]/schedule — Approved content -> a scheduled
 * `broadcasts` row (agent+, matching who can already run the existing
 * Broadcasts feature).
 *
 * Body: { language?: string | null, scheduled_at: string (ISO),
 *   audience: { roles?: string[], markets?: string[] } }
 *
 * There is no separate "send immediately" request shape — a caller
 * that wants an immediate send just passes `scheduled_at: now`. Every
 * post, without exception, goes out through the cron drain
 * (GET /api/content/cron); see create_content_broadcast_with_recipients's
 * comment for why that's one send path instead of two.
 *
 * A single content item can be scheduled more than once (e.g. once
 * per language) — each call creates one more `broadcasts` row against
 * the same content_id.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const { id } = await params;

    const { data: content, error: contentErr } = await supabase
      .from('content')
      .select('id, title, status')
      .eq('id', id)
      .maybeSingle();
    if (contentErr)
      return NextResponse.json({ error: contentErr.message }, { status: 500 });
    if (!content)
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    if (content.status !== 'Approved') {
      return NextResponse.json(
        {
          error: `Only Approved content can be scheduled (current status: "${content.status}").`,
        },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const language = body.language ?? null;
    if (
      language !== null &&
      !(LANGUAGES as readonly string[]).includes(language)
    ) {
      return NextResponse.json(
        {
          error: `language must be null (source) or one of: ${LANGUAGES.join(', ')}`,
        },
        { status: 400 }
      );
    }
    if (language) {
      const { data: translation, error: translationErr } = await supabase
        .from('content_translations')
        .select('id')
        .eq('content_id', id)
        .eq('language', language)
        .maybeSingle();
      if (translationErr) {
        return NextResponse.json(
          { error: translationErr.message },
          { status: 500 }
        );
      }
      if (!translation) {
        return NextResponse.json(
          {
            error: `No "${language}" translation exists for this content yet.`,
          },
          { status: 400 }
        );
      }
    }

    const scheduledAtRaw = body.scheduled_at;
    const scheduledAt =
      typeof scheduledAtRaw === 'string' ? new Date(scheduledAtRaw) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: 'scheduled_at must be a valid ISO date string' },
        { status: 400 }
      );
    }

    const audience: AudienceSelector =
      body.audience && typeof body.audience === 'object'
        ? {
            roles: Array.isArray(body.audience.roles)
              ? body.audience.roles
              : undefined,
            markets: Array.isArray(body.audience.markets)
              ? body.audience.markets
              : undefined,
          }
        : {};

    const contacts = await resolveAudienceContacts(
      supabase,
      accountId,
      audience
    );
    if (contacts.length === 0) {
      return NextResponse.json(
        {
          error:
            'No confirmed, opted-in Members match this audience — nothing to schedule.',
        },
        { status: 400 }
      );
    }

    // Demo-vs-real is frozen at creation, same reasoning migration
    // 052 documents for template broadcasts: a scheduled post must
    // never switch mid-flight because someone toggled the account
    // setting between now and when the cron drain runs it.
    const admin = supabaseAdmin();
    const { data: account, error: accountErr } = await supabase
      .from('accounts')
      .select('demo_mode_enabled')
      .eq('id', accountId)
      .maybeSingle();
    if (accountErr)
      return NextResponse.json({ error: accountErr.message }, { status: 500 });
    const isDemo = account?.demo_mode_enabled ?? true;

    const { data: rpcRows, error: rpcErr } = await admin.rpc(
      'create_content_broadcast_with_recipients',
      {
        p_account_id: accountId,
        p_user_id: userId,
        p_name: `${content.title}${language ? ` (${language})` : ''}`,
        p_content_id: id,
        p_language: language,
        p_scheduled_at: scheduledAt.toISOString(),
        p_audience_filter: audience,
        p_contact_ids: contacts.map((c) => c.id),
        p_is_demo: isDemo,
      }
    );
    if (rpcErr || !rpcRows || rpcRows.length === 0) {
      console.error('[content-schedule] RPC failed:', rpcErr);
      return NextResponse.json(
        { error: 'Failed to schedule this post' },
        { status: 500 }
      );
    }

    await supabase
      .from('content')
      .update({ status: 'Scheduled' })
      .eq('id', id)
      .eq('status', 'Approved');

    return NextResponse.json(
      {
        broadcast_id: rpcRows[0].broadcast_id,
        recipient_count: contacts.length,
        scheduled_at: scheduledAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
