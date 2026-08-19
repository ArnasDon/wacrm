import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const LANGUAGES = ['ur', 'ps', 'pa', 'ur-Roman'] as const;

// GET  — list voice notes for this content item.
// POST — record a voice note's metadata row. The audio itself is
// already in Storage by the time this is called — the client uploads
// straight to the `chat-media` bucket (account-<account_id>/...,
// migration 023) via the existing `uploadAccountMedia` helper, the
// same path the inbox composer's recorder already uses, then posts
// the resulting object path here. Keeping the upload client-side (not
// proxied through this route) avoids doubling the audio through the
// Next.js server for no benefit — the bucket's RLS already scopes the
// write to this account.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('voice_notes')
      .select('*')
      .eq('content_id', id)
      .order('created_at', { ascending: false });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ voice_notes: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const language = body.language;
    const storagePath =
      typeof body.storage_path === 'string' ? body.storage_path : '';
    const durationSeconds =
      typeof body.duration_seconds === 'number'
        ? Math.round(body.duration_seconds)
        : null;
    const contentTranslationId =
      typeof body.content_translation_id === 'string'
        ? body.content_translation_id
        : null;

    if (!(LANGUAGES as readonly string[]).includes(language)) {
      return NextResponse.json(
        { error: `language must be one of: ${LANGUAGES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!storagePath) {
      return NextResponse.json(
        { error: 'storage_path is required' },
        { status: 400 }
      );
    }
    // Guard against a caller pointing this row at another account's
    // object — the bucket path convention is account-<account_id>/...
    // (migration 023), so a mismatch here means either a bug on the
    // client or a spoofed request.
    if (!storagePath.startsWith(`account-${accountId}/`)) {
      return NextResponse.json(
        { error: "storage_path must be under this account's media path" },
        { status: 400 }
      );
    }

    const { data: content, error: contentErr } = await supabase
      .from('content')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (contentErr)
      return NextResponse.json({ error: contentErr.message }, { status: 500 });
    if (!content)
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });

    const { data, error } = await supabase
      .from('voice_notes')
      .insert({
        account_id: accountId,
        content_id: id,
        content_translation_id: contentTranslationId,
        language,
        storage_path: storagePath,
        duration_seconds: durationSeconds,
        source: 'recorded',
        recorded_by: userId,
      })
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ voice_note: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
