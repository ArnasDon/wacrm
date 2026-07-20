import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig, saveAiConfig } from '@/lib/ai/config'
import type { AiProvider } from '@/lib/ai/types'

const PROVIDERS: AiProvider[] = ['openai', 'anthropic']

/** GET /api/ai/config (agent+) — never returns the raw key, only whether one is set. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const config = await loadAiConfig(supabase, accountId)
    if (!config) return NextResponse.json({ config: null })

    const { apiKey: _apiKey, ...safeConfig } = config
    void _apiKey
    return NextResponse.json({ config: safeConfig, hasApiKey: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/ai/config (admin+)
 *
 * A blank `apiKey` means "keep the current stored key" — the Settings
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
    return toErrorResponse(err)
  }
}
