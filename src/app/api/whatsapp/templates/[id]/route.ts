import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeLocalTemplatePayload } from '@/lib/whatsapp/local-template-payload'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveRequestContext() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as const
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return {
      error: NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      ),
    } as const
  }

  return { supabase, accountId } as const
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }

    const resolved = await resolveRequestContext()
    if ('error' in resolved) return resolved.error
    const { supabase, accountId } = resolved

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    const payload = normalizeLocalTemplatePayload(await request.json())
    const { data: template, error } = await supabase
      .from('message_templates')
      .update({
        ...payload,
        status: 'APPROVED',
        meta_template_id: null,
        rejection_reason: null,
        quality_score: null,
        submission_error: null,
        last_submitted_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()

    if (error) {
      const isDuplicate =
        error.code === '23505' || /duplicate key/i.test(error.message)
      return NextResponse.json(
        {
          error: isDuplicate
            ? 'A template with this name and language already exists.'
            : `Failed to update template: ${error.message}`,
        },
        { status: isDuplicate ? 409 : 500 },
      )
    }

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('Error updating template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to update template.',
      },
      { status: 400 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }

    const resolved = await resolveRequestContext()
    if ('error' in resolved) return resolved.error
    const { supabase, accountId } = resolved

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    const { error: delErr } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (delErr) {
      return NextResponse.json(
        { error: `Failed to delete template: ${delErr.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to delete template.',
      },
      { status: 500 },
    )
  }
}
