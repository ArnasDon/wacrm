import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET  /api/content — list this account's Content Studio items.
// POST /api/content — create a new Draft item (agent+).
//
// RLS (content_select/content_insert, migration 046) already scopes
// both by account_id + agent+ for writes; requireRole is the same
// belt-and-suspenders pattern every other write route in this
// codebase uses (a clear 401/403 instead of a confusing empty RLS
// rejection).

const CONTENT_TYPES = [
  'poster',
  'image',
  'video',
  'text_post',
  'voice_note',
  'product_post',
  'campaign_post',
] as const;

export async function GET(request: Request) {
  try {
    const { supabase } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabase
      .from('content')
      .select(
        '*, translations:content_translations(id, language), voice_notes(id, language)'
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ content: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const contentType = body.content_type;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (!(CONTENT_TYPES as readonly string[]).includes(contentType)) {
      return NextResponse.json(
        { error: `content_type must be one of: ${CONTENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('content')
      .insert({
        account_id: accountId,
        title,
        content_type: contentType,
        body: typeof body.body === 'string' ? body.body : null,
        media_url: typeof body.media_url === 'string' ? body.media_url : null,
        product_id:
          typeof body.product_id === 'string' ? body.product_id : null,
        campaign_id:
          typeof body.campaign_id === 'string' ? body.campaign_id : null,
        status: 'Draft',
        created_by: userId,
      })
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ content: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
