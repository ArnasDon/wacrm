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
import { AiError, type AiProvider } from '@/lib/ai/types'
import { validateBusinessHours, BusinessHoursError } from '@/lib/calendar/business-hours'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const WEEKDAYS_MON_FRI = ['mon', 'tue', 'wed', 'thu', 'fri'] as const

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key, commercial_system_prompt, commercial_mode_enabled, commercial_booking_url, commercial_welcome_message, commercial_calendar_id, commercial_busy_calendar_ids, commercial_meeting_duration_min, commercial_timezone, commercial_business_hours, commercial_min_lead_time_min, commercial_buffer_min, commercial_max_business_days_ahead',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    if (!data) return NextResponse.json({ configured: false })
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'claude-agent-sdk') {
      return bad('provider must be "openai", "anthropic", or "claude-agent-sdk"')
    }
    // "claude-agent-sdk" authenticates with the service's own
    // CLAUDE_CODE_OAUTH_TOKEN (see providers/claude-agent-sdk.ts) —
    // there is no per-account key to collect or store for it.
    const requiresApiKey = provider !== 'claude-agent-sdk'
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    // Bloco 3-A — commercial mode fields. All optional; only touched
    // when the form actually sends them (mirrors handoff_agent_id
    // above), so a partial save from an older client build can't wipe
    // them.
    const commercialModeProvided = 'commercial_mode_enabled' in body
    const commercialModeEnabled = body.commercial_mode_enabled === true

    const commercialPromptProvided = 'commercial_system_prompt' in body
    const commercialSystemPrompt =
      typeof body.commercial_system_prompt === 'string' && body.commercial_system_prompt.trim()
        ? body.commercial_system_prompt.trim()
        : null

    const commercialWelcomeProvided = 'commercial_welcome_message' in body
    const commercialWelcomeMessage =
      typeof body.commercial_welcome_message === 'string' &&
      body.commercial_welcome_message.trim()
        ? body.commercial_welcome_message.trim()
        : null

    const commercialBookingUrlProvided = 'commercial_booking_url' in body
    let commercialBookingUrl: string | null = null
    if (commercialBookingUrlProvided) {
      const raw =
        typeof body.commercial_booking_url === 'string' ? body.commercial_booking_url.trim() : ''
      if (raw) {
        try {
          const parsed = new URL(raw)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return bad('commercial_booking_url must be an http(s) URL')
          }
        } catch {
          return bad('commercial_booking_url must be a valid URL')
        }
        commercialBookingUrl = raw
      }
    }

    // Bloco 3-A — commercial-mode scheduling (migration 046). All
    // optional and only touched when the form sends them, mirroring
    // handoff_agent_id/the commercial fields above — a partial save
    // never wipes them.
    const commercialCalendarIdProvided = 'commercial_calendar_id' in body
    const commercialCalendarId =
      typeof body.commercial_calendar_id === 'string' && body.commercial_calendar_id.trim()
        ? body.commercial_calendar_id.trim()
        : null

    const commercialBusyCalendarIdsProvided = 'commercial_busy_calendar_ids' in body
    let commercialBusyCalendarIds: string[] = []
    if (commercialBusyCalendarIdsProvided) {
      const raw = body.commercial_busy_calendar_ids
      if (Array.isArray(raw)) {
        commercialBusyCalendarIds = raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
      } else if (typeof raw === 'string') {
        commercialBusyCalendarIds = raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } else {
        return bad('commercial_busy_calendar_ids must be an array or a comma-separated string')
      }
    }

    const commercialDurationProvided = 'commercial_meeting_duration_min' in body
    let commercialDuration = 30
    if (commercialDurationProvided) {
      commercialDuration = Number(body.commercial_meeting_duration_min)
      if (!Number.isFinite(commercialDuration) || commercialDuration <= 0) {
        return bad('commercial_meeting_duration_min must be a positive number')
      }
      commercialDuration = Math.floor(commercialDuration)
    }

    const commercialTimezoneProvided = 'commercial_timezone' in body
    const commercialTimezone =
      typeof body.commercial_timezone === 'string' && body.commercial_timezone.trim()
        ? body.commercial_timezone.trim()
        : 'Europe/Lisbon'

    // Business hours are exposed to the settings UI as a single
    // Mon–Fri start/end pair (`commercial_business_hours_start/end`)
    // rather than the raw per-weekday JSON — that's the actual shape
    // Ricardo asked for ("dias de semana, das 09h00 às 18h00"). The
    // stored column is still the full BusinessHours JSONB so
    // calculateAvailability can consume it directly.
    const commercialHoursProvided =
      'commercial_business_hours_start' in body || 'commercial_business_hours_end' in body
    let commercialBusinessHours: ReturnType<typeof validateBusinessHours> | undefined
    if (commercialHoursProvided) {
      const start =
        typeof body.commercial_business_hours_start === 'string'
          ? body.commercial_business_hours_start.trim()
          : '09:00'
      const end =
        typeof body.commercial_business_hours_end === 'string'
          ? body.commercial_business_hours_end.trim()
          : '18:00'
      if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
        return bad('commercial_business_hours_start/end must be "HH:MM"')
      }
      if (end <= start) {
        return bad('commercial_business_hours_end must be after commercial_business_hours_start')
      }
      const hours: Record<string, [string, string][]> = {}
      for (const day of WEEKDAYS_MON_FRI) hours[day] = [[start, end]]
      try {
        commercialBusinessHours = validateBusinessHours(hours)
      } catch (err) {
        if (err instanceof BusinessHoursError) return bad(err.message)
        throw err
      }
    }

    const commercialMinLeadProvided = 'commercial_min_lead_time_min' in body
    let commercialMinLead = 120
    if (commercialMinLeadProvided) {
      commercialMinLead = Number(body.commercial_min_lead_time_min)
      if (!Number.isFinite(commercialMinLead) || commercialMinLead < 0) {
        return bad('commercial_min_lead_time_min must be a non-negative number')
      }
      commercialMinLead = Math.floor(commercialMinLead)
    }

    const commercialBufferProvided = 'commercial_buffer_min' in body
    let commercialBuffer = 15
    if (commercialBufferProvided) {
      commercialBuffer = Number(body.commercial_buffer_min)
      if (!Number.isFinite(commercialBuffer) || commercialBuffer < 0) {
        return bad('commercial_buffer_min must be a non-negative number')
      }
      commercialBuffer = Math.floor(commercialBuffer)
    }

    const commercialMaxDaysProvided = 'commercial_max_business_days_ahead' in body
    let commercialMaxDays = 10
    if (commercialMaxDaysProvided) {
      commercialMaxDays = Number(body.commercial_max_business_days_ahead)
      if (!Number.isFinite(commercialMaxDays) || commercialMaxDays <= 0) {
        return bad('commercial_max_business_days_ahead must be a positive number')
      }
      commercialMaxDays = Math.floor(commercialMaxDays)
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    // "claude-agent-sdk" has no per-account key at all (see
    // `requiresApiKey` above) — `apiKeyPlain` stays '' and is simply
    // ignored by that provider's adapter (providers/claude-agent-sdk.ts
    // reads CLAUDE_CODE_OAUTH_TOKEN from the service's own environment).
    let apiKeyPlain = ''
    if (requiresApiKey) {
      if (rawKey) {
        apiKeyPlain = rawKey
      } else if (existing?.api_key) {
        try {
          apiKeyPlain = decrypt(existing.api_key)
        } catch {
          return bad('Stored API key could not be decrypted — re-enter your key.')
        }
      } else {
        return bad('api_key is required')
      }
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (commercialModeProvided) shared.commercial_mode_enabled = commercialModeEnabled
    if (commercialPromptProvided) shared.commercial_system_prompt = commercialSystemPrompt
    if (commercialWelcomeProvided) shared.commercial_welcome_message = commercialWelcomeMessage
    if (commercialBookingUrlProvided) shared.commercial_booking_url = commercialBookingUrl
    if (commercialCalendarIdProvided) shared.commercial_calendar_id = commercialCalendarId
    if (commercialBusyCalendarIdsProvided) shared.commercial_busy_calendar_ids = commercialBusyCalendarIds
    if (commercialDurationProvided) shared.commercial_meeting_duration_min = commercialDuration
    if (commercialTimezoneProvided) shared.commercial_timezone = commercialTimezone
    if (commercialHoursProvided) shared.commercial_business_hours = commercialBusinessHours
    if (commercialMinLeadProvided) shared.commercial_min_lead_time_min = commercialMinLead
    if (commercialBufferProvided) shared.commercial_buffer_min = commercialBuffer
    if (commercialMaxDaysProvided) shared.commercial_max_business_days_ahead = commercialMaxDays
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        // Non-null for 'openai'/'anthropic' (rawKey required above when
        // there's no existing row); null for 'claude-agent-sdk', which
        // has no per-account key at all — see migration 047.
        api_key: encryptedKey,
        ...shared,
      })
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
