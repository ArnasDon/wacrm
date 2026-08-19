import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const LANGUAGES = ['ur', 'ps', 'pa', 'ur-Roman'] as const;

// GET  — list this content item's translations.
// POST — create or update (upsert, keyed on language) a translation.
//
// §14: a BA may only write a ContentTranslation for a language in
// their own profile.languages — admins/owners are exempt (full
// internal platform access). This is enforced here, not in RLS: RLS
// (migration 046) can't read the caller's own profile row without a
// dedicated SECURITY DEFINER helper, which is exactly what that
// migration's header flagged as deferred to this phase.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('content_translations')
      .select('*')
      .eq('content_id', id)
      .order('language', { ascending: true });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ translations: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId, accountId, role } = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const language = body.language;
    const text = typeof body.body === 'string' ? body.body.trim() : '';

    if (!(LANGUAGES as readonly string[]).includes(language)) {
      return NextResponse.json(
        { error: `language must be one of: ${LANGUAGES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!text) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    // Admins/owners may write any language; a BA is restricted to
    // languages in their own profile.
    const isAdmin = role === 'admin' || role === 'owner';
    if (!isAdmin) {
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('languages')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) {
        return NextResponse.json(
          { error: profileErr.message },
          { status: 500 }
        );
      }
      const myLanguages: string[] = Array.isArray(profile?.languages)
        ? profile.languages
        : [];
      if (!myLanguages.includes(language)) {
        return NextResponse.json(
          {
            error: `You are not registered for "${language}" translations. Ask an admin to add it to your BA languages in Settings, or have a BA who has it write this translation.`,
          },
          { status: 403 }
        );
      }
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
      .from('content_translations')
      .upsert(
        {
          account_id: accountId,
          content_id: id,
          language,
          body: text,
          translated_by: userId,
        },
        { onConflict: 'content_id,language' }
      )
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ translation: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
