import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const EDITABLE_STATUSES = ['Draft', 'In Review'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('content')
      .select('*, translations:content_translations(*), voice_notes(*)')
      .eq('id', id)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    return NextResponse.json({ content: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id } = await params;

    const { data: existing, error: fetchErr } = await supabase
      .from('content')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing)
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      return NextResponse.json(
        {
          error: `Cannot edit content in status "${existing.status}" — only Draft or In Review items can be edited.`,
        },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title)
        return NextResponse.json(
          { error: 'title cannot be empty' },
          { status: 400 }
        );
      update.title = title;
    }
    if (typeof body.body === 'string' || body.body === null)
      update.body = body.body;
    if (typeof body.media_url === 'string' || body.media_url === null) {
      update.media_url = body.media_url;
    }
    if (typeof body.product_id === 'string' || body.product_id === null) {
      update.product_id = body.product_id;
    }
    if (typeof body.campaign_id === 'string' || body.campaign_id === null) {
      update.campaign_id = body.campaign_id;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('content')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ content: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, role } = await requireRole('agent');
    const { id } = await params;

    const { data: existing, error: fetchErr } = await supabase
      .from('content')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing)
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });

    const callerIsAdmin = role === 'admin' || role === 'owner';
    if (!callerIsAdmin && !['Draft', 'Archived'].includes(existing.status)) {
      return NextResponse.json(
        {
          error:
            'Only Draft or Archived content can be deleted (admins can delete any status).',
        },
        { status: 403 }
      );
    }

    const { error } = await supabase.from('content').delete().eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
