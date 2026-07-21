import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeLocalTemplatePayload } from '@/lib/whatsapp/local-template-payload'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const payload = normalizeLocalTemplatePayload(await request.json())

    const { data: template, error } = await supabase
      .from('message_templates')
      .insert({
        account_id: accountId,
        user_id: user.id,
        ...payload,
        status: 'APPROVED',
        meta_template_id: null,
        rejection_reason: null,
        quality_score: null,
        submission_error: null,
        last_submitted_at: null,
      })
      .select('*')
      .single()

    if (error) {
      const isDuplicate =
        error.code === '23505' || /duplicate key/i.test(error.message)
      return NextResponse.json(
        {
          error: isDuplicate
            ? 'A template with this name and language already exists.'
            : `Failed to save template: ${error.message}`,
        },
        { status: isDuplicate ? 409 : 500 },
      )
    }

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('Error saving local template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to save template.',
      },
      { status: 400 },
    )
  }
}
