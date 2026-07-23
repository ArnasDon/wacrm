import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig, saveAiConfig } from '@/lib/ai/config'
import type { AiProvider } from '@/lib/ai/types'
import { EncryptionConfigError } from '@/lib/whatsapp/encryption'

const PROVIDERS: AiProvider[] = ['openai', 'anthropic']

function isMissingAiSchemaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false

  const candidate = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const haystack = [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST205' ||
    haystack.includes('relation "ai_configs" does not exist') ||
    haystack.includes("column 'api_key_encrypted' does not exist") ||
    haystack.includes('column "api_key_encrypted" does not exist')
  )
}

function toAiConfigErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof EncryptionConfigError) {
    return NextResponse.json(
      {
        error: `${err.message} Configure the production server env before saving AI agent settings.`,
        code: 'encryption_key_invalid',
      },
      { status: 503 },
    )
  }

  if (isMissingAiSchemaError(err)) {
    return NextResponse.json(
      {
        error: 'AI agent database schema is missing in this environment. Apply migration 038_ai_agent.sql.',
        code: 'ai_schema_missing',
      },
      { status: 503 },
    )
  }

  return null
}

/** GET /api/ai/config (agent+) - never returns the raw key, only whether one is set. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const config = await loadAiConfig(supabase, accountId)
    if (!config) return NextResponse.json({ config: null })

    const { apiKey: _apiKey, ...safeConfig } = config
    void _apiKey
    return NextResponse.json({ config: safeConfig, hasApiKey: true })
  } catch (err) {
    return toAiConfigErrorResponse(err) ?? toErrorResponse(err)
  }
}

/**
 * PUT /api/ai/config (admin+)
 *
 * A blank `apiKey` means "keep the current stored key" - the Settings
 * UI always clears the field back to '' after load/save (it never
 * echoes the decrypted key to the client), so every save after the
 * first one submits apiKey: ''. Only reject when there is no existing
 * config to fall back to (first-ever save must include a real key).
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)

    if (!body || !PROVIDERS.includes(body.provider)) {
      return NextResponse.json({ error: 'provider must be openai or anthropic' }, { status: 400 })
    }
    if (typeof body.model !== 'string' || !body.model.trim()) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    const submittedApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    let apiKey = submittedApiKey
    if (!apiKey) {
      const existing = await loadAiConfig(supabase, accountId)
      if (!existing) {
        return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
      }
      apiKey = existing.apiKey
    }

    await saveAiConfig(supabase, accountId, {
      provider: body.provider,
      model: body.model.trim(),
      apiKey,
      agentEnabled: Boolean(body.agentEnabled),
      pipelineMoveEnabled: Boolean(body.pipelineMoveEnabled),
      autoReplyMaxPerConversation:
        Number.isFinite(body.autoReplyMaxPerConversation) && body.autoReplyMaxPerConversation > 0
          ? Math.floor(body.autoReplyMaxPerConversation)
          : 3,
      handoffAgentId: typeof body.handoffAgentId === 'string' ? body.handoffAgentId : null,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toAiConfigErrorResponse(err) ?? toErrorResponse(err)
  }
}
