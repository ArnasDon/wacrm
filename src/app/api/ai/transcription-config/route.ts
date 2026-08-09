import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const { data, error } = await supabaseAdmin()
      .from('ai_configs')
      .select('provider, is_active, api_key, embeddings_api_key, transcription_enabled')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Failed to load transcription configuration' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ configured: false })
    }

    const hasPrimaryOpenAiKey = data.provider === 'openai' && Boolean(data.api_key)
    const hasDedicatedOpenAiKey = Boolean(data.embeddings_api_key)

    return NextResponse.json({
      configured: true,
      enabled: data.transcription_enabled !== false,
      provider: 'openai',
      model: 'whisper-1',
      language: 'auto',
      timeout_seconds: 25,
      ai_config_active: Boolean(data.is_active),
      key_source: hasDedicatedOpenAiKey
        ? 'dedicated'
        : hasPrimaryOpenAiKey
          ? 'primary'
          : 'missing',
      ready: Boolean(data.is_active) && (hasDedicatedOpenAiKey || hasPrimaryOpenAiKey),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    const { data: existing, error: loadError } = await supabaseAdmin()
      .from('ai_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (loadError) {
      return NextResponse.json({ error: 'Failed to load AI configuration' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'Configure the AI provider first before enabling audio transcription.' },
        { status: 409 },
      )
    }

    const { error } = await supabaseAdmin()
      .from('ai_configs')
      .update({ transcription_enabled: body.enabled })
      .eq('account_id', accountId)

    if (error) {
      return NextResponse.json({ error: 'Failed to save transcription configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true, enabled: body.enabled })
  } catch (error) {
    return toErrorResponse(error)
  }
}
