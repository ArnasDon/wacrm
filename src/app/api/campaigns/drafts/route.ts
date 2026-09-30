// POST /api/campaigns/drafts — save the campaign wizard as a draft
// (a broadcasts row with status 'draft' carrying the wizard state), so
// "Continue setup" on the Campaigns page reopens it exactly.
//
// Body: { id? (update this draft), name, state }. Returns { id }.

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

/** Keeps a draft row a sensible size — a huge CSV is re-uploaded instead. */
const MAX_STATE_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const body = (await request.json().catch(() => null)) ?? {};
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : 'Untitled campaign';
    const state =
      body.state && typeof body.state === 'object' ? body.state : null;
    if (!state)
      return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });

    let draftState = state;
    let csvDropped = false;
    if (JSON.stringify(state).length > MAX_STATE_BYTES && state.audience?.csv) {
      draftState = { ...state, audience: { ...state.audience, csv: null } };
      csvDropped = true;
    }
    const firstTemplate = Object.values(
      (state.channelTemplates ?? {}) as Record<
        string,
        { name: string; language: string }[]
      >
    ).flat()[0];
    const row = {
      name,
      kind: 'advanced',
      status: 'draft',
      template_name: firstTemplate?.name ?? '—',
      template_language: firstTemplate?.language ?? 'en_US',
      config: {
        version: 1,
        mode: state.mode === 'standard' ? 'standard' : 'advanced',
        draft_state: draftState,
      },
      updated_at: new Date().toISOString(),
    };

    const db = supabaseAdmin();
    if (typeof body.id === 'string') {
      const { data, error } = await db
        .from('broadcasts')
        .update(row)
        .eq('id', body.id)
        .eq('account_id', accountId)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data)
        return NextResponse.json({ id: data.id, csv_dropped: csvDropped });
    }
    const { data, error } = await db
      .from('broadcasts')
      .insert({
        ...row,
        user_id: userId,
        account_id: accountId,
        total_recipients: 0,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(
      { id: data.id, csv_dropped: csvDropped },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
