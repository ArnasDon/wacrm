import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  normalizeCommercialStrategy,
  serializeCommercialStrategy,
} from '@/lib/ai/commercial-strategy'
import { AiError, type AiProvider } from '@/lib/ai/types'
import { aiContextMessageLimit } from '@/lib/ai/defaults'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const db = supabaseAdmin()
    const { data, error } = await db
      .from('ai_configs')
      .select('provider, model, system_prompt, commercial_strategy, is_active, auto_reply_enabled, auto_reply_max_per_conversation, buffer_window_seconds, max_reply_chunks, handoff_agent_id, api_key, embeddings_api_key, usd_to_mzn_rate, usd_to_mzn_rate_updated_at, temperature, agent_name, agent_role, agent_language, agent_description')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load AI configuration' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })
    const { api_key, embeddings_api_key, commercial_strategy, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      commercial_strategy: serializeCommercialStrategy(
        normalizeCommercialStrategy(commercial_strategy),
      ),
      context_message_limit: aiContextMessageLimit(),
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const db = supabaseAdmin()
    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') return bad('provider must be "openai" or "anthropic"')
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    const systemPrompt = typeof body.system_prompt === 'string' && body.system_prompt.trim() ? body.system_prompt.trim() : null

    const trimmedOrNull = (value: unknown, maxLength: number): string | null => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed ? trimmed.slice(0, maxLength) : null
    }
    const agentName = trimmedOrNull(body.agent_name, 80)
    const agentRole = trimmedOrNull(body.agent_role, 120)
    const agentLanguage = trimmedOrNull(body.agent_language, 40)
    const agentDescription = trimmedOrNull(body.agent_description, 500)
    const commercialStrategy = normalizeCommercialStrategy(body.commercial_strategy)
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true
    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(100, Math.max(1, Math.floor(maxPer)))
    let bufferWindowSeconds = Number(body.buffer_window_seconds)
    if (!Number.isFinite(bufferWindowSeconds)) bufferWindowSeconds = 12
    bufferWindowSeconds = Math.min(30, Math.max(1, Math.floor(bufferWindowSeconds)))
    let maxReplyChunks = Number(body.max_reply_chunks)
    if (!Number.isFinite(maxReplyChunks)) maxReplyChunks = 3
    maxReplyChunks = Math.min(5, Math.max(1, Math.floor(maxReplyChunks)))

    // null/omitted means "use the provider's own default" — the field is
    // simply left out of the request body (see providers/openai.ts and
    // providers/anthropic.ts).
    let temperature: number | null = null
    if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
      temperature = Math.round(Math.min(2, Math.max(0, body.temperature)) * 100) / 100
    } else if (body.temperature !== undefined && body.temperature !== null) {
      return bad('temperature must be a number between 0 and 2')
    }

    const rawHandoff = typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase.from('profiles').select('user_id').eq('account_id', accountId).eq('user_id', rawHandoff).maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const rawEmbeddingsKey = typeof body.embeddings_api_key === 'string' ? body.embeddings_api_key.trim() : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    const { data: existing, error: existingError } = await db
      .from('ai_configs')
      .select('id, provider, model, api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) return NextResponse.json({ error: 'Failed to load existing AI configuration' }, { status: 500 })

    let apiKeyPlain: string
    if (rawKey) apiKeyPlain = rawKey
    else if (existing?.api_key) {
      try { apiKeyPlain = decrypt(existing.api_key) }
      catch { return bad('Stored API key could not be decrypted — re-enter your key.') }
    } else return bad('api_key is required')

    const credentialsChanged = !existing || rawKey !== '' || provider !== existing.provider || model !== existing.model
    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          agentId: existing?.id ?? 'credential-validation',
          provider,
          model,
          apiKey: apiKeyPlain,
          systemPrompt,
          commercialStrategy,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          bufferWindowSeconds,
          maxReplyChunks,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
        return bad('Could not validate the API key with the provider.')
      }
    }

    if (rawEmbeddingsKey) {
      try { await embedTexts(rawEmbeddingsKey, ['ping']) }
      catch (err) {
        if (err instanceof AiError) return NextResponse.json({ error: `Embeddings key: ${err.message}`, code: err.code }, { status: 400 })
        return bad('Could not validate the embeddings key.')
      }
    }

    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      commercial_strategy: serializeCommercialStrategy(commercialStrategy),
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
      buffer_window_seconds: bufferWindowSeconds,
      max_reply_chunks: maxReplyChunks,
      temperature,
      agent_name: agentName,
      agent_role: agentRole,
      agent_language: agentLanguage,
      agent_description: agentDescription,
    }
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (rawEmbeddingsKey) shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    else if (clearEmbeddingsKey) shared.embeddings_api_key = null

    if (existing) {
      const updatePayload: Record<string, unknown> = { ...shared }
      if (rawKey) updatePayload.api_key = encrypt(rawKey)
      const { error } = await db.from('ai_configs').update(updatePayload).eq('account_id', accountId)
      if (error) return NextResponse.json({ error: 'Failed to save AI configuration' }, { status: 500 })
    } else {
      const { error } = await db.from('ai_configs').insert({ account_id: accountId, created_by: userId, api_key: encrypt(rawKey), ...shared })
      if (error) return NextResponse.json({ error: 'Failed to save AI configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/config — narrow, single-purpose update for the two dials
 * exposed inline from the live agent-flow panel (buffer window, reply
 * chunking). Deliberately does not touch system_prompt, commercial_strategy
 * or credentials: unlike POST, callers here only ever send the one field
 * being adjusted, so anything else must be left untouched rather than
 * defaulted/wiped.
 */
export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const db = supabaseAdmin()
    const limit = checkRateLimit(`ai-config-patch:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const update: Record<string, number> = {}
    if ('buffer_window_seconds' in body) {
      const value = Number(body.buffer_window_seconds)
      if (!Number.isFinite(value)) return bad('buffer_window_seconds must be a number')
      update.buffer_window_seconds = Math.min(30, Math.max(1, Math.floor(value)))
    }
    if ('max_reply_chunks' in body) {
      const value = Number(body.max_reply_chunks)
      if (!Number.isFinite(value)) return bad('max_reply_chunks must be a number')
      update.max_reply_chunks = Math.min(5, Math.max(1, Math.floor(value)))
    }
    if (Object.keys(update).length === 0) return bad('Nothing to update')

    const { error } = await db.from('ai_configs').update(update).eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to save AI configuration' }, { status: 500 })

    return NextResponse.json({ success: true, ...update })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    const { error } = await supabaseAdmin().from('ai_configs').delete().eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to delete AI configuration' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
