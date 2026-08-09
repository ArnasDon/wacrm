import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { DEFAULT_COMMERCIAL_STRATEGY } from '@/lib/ai/commercial-strategy'
import { AiError, type AiProvider } from '@/lib/ai/types'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') return NextResponse.json({ error: 'provider must be "openai" or "anthropic"' }, { status: 400 })
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return NextResponse.json({ error: 'model is required' }, { status: 400 })

    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      if (!existing?.api_key) return NextResponse.json({ error: 'Enter an API key to test.' }, { status: 400 })
      try { apiKeyPlain = decrypt(existing.api_key) }
      catch { return NextResponse.json({ error: 'Stored API key could not be decrypted — re-enter your key.' }, { status: 400 }) }
    }

    try {
      await validateAiCredentials({
        agentId: existing?.id ?? 'credential-test',
        provider,
        model,
        apiKey: apiKeyPlain,
        systemPrompt: null,
        commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        bufferWindowSeconds: 12,
        maxReplyChunks: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
      })
    } catch (err) {
      if (err instanceof AiError) return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      return NextResponse.json({ error: 'Could not validate the API key.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
