import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate session user
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch user's profile and account_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Profile is not linked to an account' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { name, template, audience, variables, headerMediaUrl } = body;

    if (!template || !template.name) {
      return NextResponse.json(
        { error: 'Template is required' },
        { status: 400 },
      );
    }

    // 3. Resolve the audience entirely in SQL (migration 041). The
    //    route only ever needs contact.id, so no contact rows cross
    //    the wire — this also sidesteps PostgREST's default 1000-row
    //    cap that used to silently truncate large tag audiences, and
    //    the request-URL bloat from a giant `.in('id', ids)`.
    const audienceArgs = {
      p_audience_type: audience.type,
      p_tag_ids: audience.type === 'tags' ? audience.tagIds ?? null : null,
      p_custom_field_id:
        audience.type === 'custom_field' ? audience.customField?.fieldId ?? null : null,
      p_custom_field_operator:
        audience.type === 'custom_field' ? audience.customField?.operator ?? null : null,
      p_custom_field_value:
        audience.type === 'custom_field' ? audience.customField?.value ?? null : null,
      p_csv_phones:
        audience.type === 'csv' && Array.isArray(audience.csvContacts)
          ? audience.csvContacts.map((c: any) => c.phone).filter(Boolean)
          : null,
      p_exclude_tag_ids:
        audience.excludeTagIds && audience.excludeTagIds.length > 0
          ? audience.excludeTagIds
          : null,
    };

    const { data: audienceCount, error: countErr } = await supabase.rpc(
      'count_audience',
      audienceArgs,
    );

    if (countErr) {
      console.error('[broadcast-create] Error counting audience:', countErr);
      return NextResponse.json(
        { error: `Failed to resolve audience: ${countErr.message}` },
        { status: 500 },
      );
    }

    const totalRecipients = Number(audienceCount ?? 0);
    if (totalRecipients === 0) {
      return NextResponse.json(
        { error: 'No recipients found for this audience' },
        { status: 400 },
      );
    }

    // 4. Insert broadcast row
    const { data: broadcast, error: bErr } = await supabase
      .from('broadcasts')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name: name || `Broadcast (${template.name})`,
        template_name: template.name,
        template_language: template.language ?? 'en_US',
        template_variables: variables,
        audience_filter: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          excludeTagIds: audience.excludeTagIds,
          ...(headerMediaUrl ? { headerMediaUrl: headerMediaUrl.trim() } : {}),
        },
        status: 'sending',
        total_recipients: totalRecipients,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (bErr || !broadcast) {
      console.error('[broadcast-create] Error inserting broadcast:', bErr);
      return NextResponse.json(
        { error: `Failed to create broadcast: ${bErr?.message ?? 'Unknown'}` },
        { status: 500 },
      );
    }

    // 5. Enqueue recipient rows with status 'pending', resolved and
    //    inserted server-side in one statement (migration 041) —
    //    replaces the old chunked client-side insert loop.
    const { data: enqueuedCount, error: rErr } = await supabase.rpc(
      'enqueue_broadcast_recipients',
      {
        p_broadcast_id: broadcast.id,
        ...audienceArgs,
      },
    );

    if (rErr) {
      await supabase
        .from('broadcasts')
        .update({ status: 'failed', failed_count: totalRecipients })
        .eq('id', broadcast.id);
      return NextResponse.json(
        { error: `Failed to enqueue recipients: ${rErr.message}` },
        { status: 500 },
      );
    }

    // enqueue_broadcast_recipients returns the number of rows it
    // actually inserted, which is the authoritative recipient count —
    // count_audience() and the enqueue are two separate point-in-time
    // reads, so a contact added/removed/retagged in between can leave
    // totalRecipients (predicted) disagreeing with what was really
    // enqueued. Reconcile broadcasts.total_recipients only when they
    // differ, so the common case stays a single insert statement.
    const actualRecipients = Number(enqueuedCount ?? totalRecipients);
    if (actualRecipients !== totalRecipients) {
      const { error: reconcileErr } = await supabase
        .from('broadcasts')
        .update({ total_recipients: actualRecipients })
        .eq('id', broadcast.id);
      if (reconcileErr) {
        console.error(
          '[broadcast-create] Error reconciling total_recipients:',
          reconcileErr,
        );
      }
    }

    // 6. No immediate drain here — the broadcast is left with every
    //    recipient row 'pending' and status 'sending'. The Cloudflare
    //    Worker's per-minute cron (calling GET /api/broadcasts/cron,
    //    which processes the ten globally-oldest-pending recipients
    //    per tick) is the only thing that sends messages, so every
    //    broadcast — including its very first message — goes out at a
    //    paced 10/min. A prior version fired an immediate background
    //    burst of up to 45 messages at 1s intervals here; that fast
    //    start is what triggered Meta's rate-limit and "healthy
    //    ecosystem engagement" throttling on the IIA campaign.
    return NextResponse.json({
      success: true,
      broadcastId: broadcast.id,
      total_recipients: actualRecipients,
    });
  } catch (error) {
    console.error('[broadcast-create] Exception in POST:', error);
    return NextResponse.json(
      { error: 'Failed to process broadcast creation' },
      { status: 500 },
    );
  }
}
