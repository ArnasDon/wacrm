import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import { aiRequestTimeoutMs } from './defaults'
import { buildConversationContext } from './context'
import { engineSendText } from '@/lib/flows/meta-send'
import {
  buildReactivationSystemPrompt,
  buildReactivationUserPrompt,
} from './reactivation-prompt'
import type {
  ReactivationCandidate,
  ReactivationDecision,
  ReactivationEvaluationResult,
  ReactivationRunResult,
} from './reactivation-types'
import type { AiConfig, AiUsage } from './types'

// Default configuration constants
export const REACTIVATION_INACTIVITY_HOURS = 3
export const REACTIVATION_MAX_INACTIVITY_HOURS = 72
export const REACTIVATION_MAX_CANDIDATES_PER_RUN = 20
export const TIMEZONE_DEFAULT = 'America/Sao_Paulo'
export const DEFAULT_BUSINESS_START_HOUR = 8
export const DEFAULT_BUSINESS_END_HOUR = 20

// ============================================================
// Business Hours Helpers (Timezone aware)
// ============================================================

interface WallClockParts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

function wallClockParts(date: Date, timeZone: string = TIMEZONE_DEFAULT): WallClockParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    mi: Number(parts.minute),
    s: Number(parts.second),
  }
}

function tzOffsetMs(date: Date, timeZone: string = TIMEZONE_DEFAULT): number {
  const p = wallClockParts(date, timeZone)
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
  return asUtc - date.getTime()
}

export function parseHourMinute(timeStr: string | null | undefined, defaultHour: number): { h: number; m: number } {
  if (!timeStr) return { h: defaultHour, m: 0 }
  const [hStr, mStr] = timeStr.split(':')
  const h = Number.parseInt(hStr, 10)
  const m = Number.parseInt(mStr ?? '0', 10)
  return {
    h: Number.isFinite(h) ? h : defaultHour,
    m: Number.isFinite(m) ? m : 0,
  }
}

export function isWithinBusinessHours(
  date: Date,
  config?: { businessHoursStart?: string | null; businessHoursEnd?: string | null } | null,
  timeZone: string = TIMEZONE_DEFAULT,
): boolean {
  const start = parseHourMinute(config?.businessHoursStart, DEFAULT_BUSINESS_START_HOUR)
  const end = parseHourMinute(config?.businessHoursEnd, DEFAULT_BUSINESS_END_HOUR)
  const { h, mi } = wallClockParts(date, timeZone)
  const currentMinutes = h * 60 + mi
  const startMinutes = start.h * 60 + start.m
  const endMinutes = end.h * 60 + end.m

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

export function getNextBusinessHourStart(
  date: Date,
  config?: { businessHoursStart?: string | null } | null,
  timeZone: string = TIMEZONE_DEFAULT,
): Date {
  const start = parseHourMinute(config?.businessHoursStart, DEFAULT_BUSINESS_START_HOUR)
  const offset = tzOffsetMs(date, timeZone)
  const p = wallClockParts(date, timeZone)
  const todayAtStartUtc = new Date(Date.UTC(p.y, p.mo - 1, p.d, start.h, start.m, 0) - offset)

  if (todayAtStartUtc.getTime() > date.getTime()) {
    return todayAtStartUtc
  }
  return new Date(todayAtStartUtc.getTime() + 24 * 60 * 60 * 1000)
}

// ============================================================
// Candidate Discovery
// ============================================================

export async function findReactivationCandidates(
  db: SupabaseClient,
  accountId: string,
  options?: {
    now?: Date
    limit?: number
    inactivityHours?: number
  },
): Promise<ReactivationCandidate[]> {
  const now = options?.now ?? new Date()
  const inactivityHours = options?.inactivityHours ?? REACTIVATION_INACTIVITY_HOURS
  const limit = options?.limit ?? REACTIVATION_MAX_CANDIDATES_PER_RUN

  const cutoffDate = new Date(now.getTime() - inactivityHours * 60 * 60 * 1000).toISOString()
  const maxCutoffDate = new Date(now.getTime() - REACTIVATION_MAX_INACTIVITY_HOURS * 60 * 60 * 1000).toISOString()

  // Query conversations eligible for reactivation
  const { data, error } = await db
    .from('conversations')
    .select(`
      id,
      account_id,
      contact_id,
      property_id,
      last_message_at,
      ai_reactivation_status,
      ai_reactivation_scheduled_for,
      ai_reactivation_sent_at,
      ai_reactivation_last_message_at,
      ai_reactivation_count,
      assigned_agent_id,
      ai_autoreply_disabled,
      ai_transfer_status,
      status,
      contact:contacts(id, name, phone),
      property:properties(id, name)
    `)
    .eq('account_id', accountId)
    .neq('status', 'closed')
    .is('assigned_agent_id', null)
    .eq('ai_autoreply_disabled', false)
    .lte('last_message_at', cutoffDate)
    .gte('last_message_at', maxCutoffDate)
    .order('last_message_at', { ascending: true })
    .limit(limit * 2)

  if (error || !data) {
    console.error('[reactivation] error querying candidates:', error)
    return []
  }

interface CandidateQueryRow {
  id: string
  account_id: string
  contact_id: string
  property_id: string | null
  last_message_at: string
  ai_reactivation_status: 'scheduled' | 'sent' | 'cancelled' | 'skipped' | 'failed' | null
  ai_reactivation_scheduled_for: string | null
  ai_reactivation_sent_at: string | null
  ai_reactivation_last_message_at: string | null
  ai_reactivation_count: number | null
  ai_transfer_status: string | null
  contact: { id: string; name: string | null; phone: string | null } | null
  property?: { id: string; name: string } | null
}

  const results: ReactivationCandidate[] = []

  for (const rawRow of data) {
    const row = rawRow as unknown as CandidateQueryRow
    if (row.ai_transfer_status === 'pending_human' || row.ai_transfer_status === 'transferred') {
      continue
    }

    // SPAM GUARD (Regra 14 / Cenário K):
    // Se já foi enviada reativação para este período de inatividade e o cliente ainda não respondeu, ignorar!
    if (
      row.ai_reactivation_status === 'sent' &&
      row.ai_reactivation_sent_at &&
      row.last_message_at <= row.ai_reactivation_sent_at
    ) {
      continue
    }

    // Se já foi pulada/cancelada e nenhuma nova mensagem chegou desde então, ignorar
    if (
      (row.ai_reactivation_status === 'skipped' || row.ai_reactivation_status === 'cancelled') &&
      row.ai_reactivation_last_message_at &&
      row.last_message_at <= row.ai_reactivation_last_message_at
    ) {
      continue
    }

    // Se estiver agendada para horário comercial futuro, verificar se já atingiu o horário
    if (row.ai_reactivation_status === 'scheduled' && row.ai_reactivation_scheduled_for) {
      const scheduledTime = new Date(row.ai_reactivation_scheduled_for).getTime()
      if (scheduledTime > now.getTime()) {
        continue // Ainda não chegou a hora agendada
      }
    }

    results.push({
      id: row.id,
      accountId: row.account_id,
      contactId: row.contact_id,
      propertyId: row.property_id,
      lastMessageAt: row.last_message_at,
      aiReactivationStatus: row.ai_reactivation_status,
      aiReactivationScheduledFor: row.ai_reactivation_scheduled_for,
      aiReactivationSentAt: row.ai_reactivation_sent_at,
      aiReactivationLastMessageAt: row.ai_reactivation_last_message_at,
      aiReactivationCount: row.ai_reactivation_count ?? 0,
      contact: row.contact ?? null,
      property: row.property ?? null,
    })

    if (results.length >= limit) break
  }

  return results
}

// ============================================================
// Single Conversation Evaluation & Execution
// ============================================================

export async function evaluateAndExecuteReactivation(
  db: SupabaseClient,
  conversationId: string,
  options?: {
    now?: Date
    simulatedHours?: 'business_hours' | 'off_hours'
    config?: AiConfig
  },
): Promise<ReactivationEvaluationResult> {
  const now = options?.now ?? new Date()

  // 1. FRESH LOOKUP (Never trust snapshot)
  const { data: convData, error: convErr } = await db
    .from('conversations')
    .select(`
      id,
      account_id,
      contact_id,
      property_id,
      last_message_at,
      ai_reactivation_status,
      ai_reactivation_scheduled_for,
      ai_reactivation_sent_at,
      ai_reactivation_last_message_at,
      ai_reactivation_count,
      assigned_agent_id,
      ai_autoreply_disabled,
      ai_transfer_status,
      status,
      contact:contacts(id, name, phone),
      property:properties(id, name)
    `)
    .eq('id', conversationId)
    .maybeSingle()

  if (convErr || !convData) {
    return { outcome: 'failed', conversationId, error: 'Conversation not found' }
  }

interface ConversationLookupRow {
  id: string
  account_id: string
  contact_id: string
  property_id: string | null
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean
  ai_transfer_status: string | null
  ai_reactivation_status: string | null
  ai_reactivation_sent_at: string | null
  ai_reactivation_last_message_at: string | null
  ai_reactivation_count: number
  last_message_at: string
  status: string
  contact?: { id: string; name: string | null; phone: string | null } | null
  property?: { id: string; name: string } | null
}

  const conv = convData as unknown as ConversationLookupRow

  // 2. CHECK HUMAN TAKEOVER / HANDOFF (Cenário I)
  if (
    conv.assigned_agent_id !== null ||
    conv.ai_autoreply_disabled ||
    conv.ai_transfer_status === 'pending_human' ||
    conv.ai_transfer_status === 'transferred'
  ) {
    if (conv.ai_reactivation_status === 'scheduled') {
      await db
        .from('conversations')
        .update({ ai_reactivation_status: 'cancelled' })
        .eq('id', conversationId)
    }
    return { outcome: 'cancelled_human_assigned', conversationId }
  }

  if (conv.status === 'closed') {
    return { outcome: 'skipped_not_eligible', conversationId }
  }

  // 3. CHECK IF CUSTOMER RESPONDED (Cenário H)
  // Re-fetch the very latest messages fresh from DB
  const { data: latestMsgs, error: msgsErr } = await db
    .from('messages')
    .select('id, sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (msgsErr || !latestMsgs || latestMsgs.length === 0) {
    return { outcome: 'skipped_not_eligible', conversationId, error: 'No messages found' }
  }

  const hasCustomerMsg = latestMsgs.some((m) => m.sender_type === 'customer')
  if (!hasCustomerMsg) {
    return { outcome: 'skipped_not_eligible', conversationId }
  }

  // If the customer replied after the candidate's last evaluated message:
  const sortedMsgs = [...latestMsgs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const newestMsg = sortedMsgs[0]

  if (
    newestMsg?.sender_type === 'customer' &&
    conv.ai_reactivation_last_message_at &&
    (conv.last_message_at > conv.ai_reactivation_last_message_at ||
      new Date(newestMsg.created_at).getTime() > new Date(conv.ai_reactivation_last_message_at).getTime())
  ) {
    await db
      .from('conversations')
      .update({ ai_reactivation_status: 'cancelled' })
      .eq('id', conversationId)
    return { outcome: 'cancelled_customer_replied', conversationId }
  }

  // 4. SPAM GUARD (Cenário K)
  if (
    conv.ai_reactivation_status === 'sent' &&
    conv.ai_reactivation_sent_at &&
    conv.last_message_at <= conv.ai_reactivation_sent_at
  ) {
    return { outcome: 'skipped_spam_guard', conversationId }
  }

  // 5. EXPLICIT OPT-OUT CHECK
  const lastCustomerMessage = latestMsgs.find((m) => m.sender_type === 'customer')?.content_text?.toLowerCase() || ''
  const optOutPhrases = [
    'não tenho interesse',
    'sem interesse',
    'não quero mais',
    'já comprei',
    'já aluguei',
    'já fechei com outro',
    'pode cancelar',
    'favor não mandar mais',
    'pare de mandar mensagem',
  ]
  if (optOutPhrases.some((phrase) => lastCustomerMessage.includes(phrase))) {
    await db
      .from('conversations')
      .update({
        ai_reactivation_status: 'cancelled',
        ai_reactivation_last_message_at: conv.last_message_at,
      })
      .eq('id', conversationId)
    return { outcome: 'cancelled_explicit_opt_out', conversationId }
  }

  // 6. LOAD AI CONFIG
  const config = options?.config ?? (await loadAiConfig(db, conv.account_id))
  if (!config || !config.isActive || !config.autoReplyEnabled) {
    return { outcome: 'skipped_not_eligible', conversationId, error: 'AI config inactive or auto-reply disabled' }
  }

  // 7. BUSINESS HOURS CHECK (08:00 - 20:00) (Cenários E, F, G)
  const isBusinessTime =
    options?.simulatedHours === 'business_hours'
      ? true
      : options?.simulatedHours === 'off_hours'
        ? false
        : isWithinBusinessHours(now, config)

  if (!isBusinessTime) {
    const nextStart = getNextBusinessHourStart(now, config)
    await db
      .from('conversations')
      .update({
        ai_reactivation_status: 'scheduled',
        ai_reactivation_scheduled_for: nextStart.toISOString(),
        ai_reactivation_last_message_at: conv.last_message_at,
      })
      .eq('id', conversationId)

    return { outcome: 'scheduled_for_business_hours', conversationId }
  }

  // 8. BUILD CONTEXT & GENERATE REACTIVATION MESSAGE
  const messages = await buildConversationContext(db, conversationId, 10)
  const contactName = conv.contact?.name ?? null
  const propertyName = conv.property?.name ?? null

  const systemPrompt = buildReactivationSystemPrompt({ identityName: config.identityName })
  const userPrompt = buildReactivationUserPrompt({
    contactName,
    propertyName,
    identityName: config.identityName,
    messages,
  })

  let rawLlmOutput = ''
  let usage: AiUsage | null = null

  try {
    const activeKey =
      config.provider === 'deepseek'
        ? (config.deepseekApiKey || config.apiKey)
        : config.apiKey
    const providerArgs = {
      apiKey: activeKey,
      model: config.model,
      systemPrompt,
      messages: [{ role: 'user' as const, content: userPrompt }],
      timeoutMs: aiRequestTimeoutMs(),
    }

    const response =
      config.provider === 'openai'
        ? await generateOpenAi(providerArgs)
        : config.provider === 'deepseek'
          ? await generateDeepSeek(providerArgs)
          : await generateAnthropic(providerArgs)

    rawLlmOutput = response.text.trim()
    usage = response.usage
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('[reactivation] LLM call failed:', err)
    return { outcome: 'failed', conversationId, error: errorMsg }
  }

  // Parse structured JSON output
  let decision: ReactivationDecision
  try {
    const cleaned = rawLlmOutput
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()
    decision = JSON.parse(cleaned)
  } catch {
    console.warn('[reactivation] Failed to parse JSON output, using raw text fallback:', rawLlmOutput)
    decision = {
      should_reactivate: rawLlmOutput.length > 10,
      reactivation_type: 'global',
      detected_need_or_clue: null,
      reason: 'Fallback parse',
      message_text: rawLlmOutput,
    }
  }

  if (!decision.should_reactivate || decision.reactivation_type === 'none' || !decision.message_text) {
    await db
      .from('conversations')
      .update({
        ai_reactivation_status: 'skipped',
        ai_reactivation_last_message_at: conv.last_message_at,
      })
      .eq('id', conversationId)
    return { outcome: 'skipped_not_appropriate', conversationId, decision }
  }

  // 9. ATOMIC LOCK, DISPATCH VIA META & UPDATE STATE
  const lockToken = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `reactivate-${Date.now()}`

  try {
    await db.rpc('acquire_ai_conversation_lock', {
      p_conversation_id: conversationId,
      p_lock_token: lockToken,
      p_ttl_seconds: 30,
    })

    // Resolve owner user id for WhatsApp audit columns
    const { data: waConfig } = await db
      .from('whatsapp_config')
      .select('user_id')
      .eq('account_id', conv.account_id)
      .maybeSingle()

    const configOwnerUserId = waConfig?.user_id || conv.assigned_agent_id || '00000000-0000-0000-0000-000000000000'

    await engineSendText({
      accountId: conv.account_id,
      userId: configOwnerUserId,
      conversationId: conv.id,
      contactId: conv.contact_id,
      text: decision.message_text,
      aiGenerated: true,
    })

    await db
      .from('conversations')
      .update({
        ai_reactivation_status: 'sent',
        ai_reactivation_sent_at: new Date().toISOString(),
        ai_reactivation_last_message_at: conv.last_message_at,
        ai_reactivation_count: (conv.ai_reactivation_count ?? 0) + 1,
      })
      .eq('id', conversationId)

    if (usage) {
      void logAiUsage(db, {
        accountId: conv.account_id,
        conversationId: conv.id,
        mode: 'auto_reply',
        provider: config.provider,
        model: config.model,
        usage,
      })
    }

    return {
      outcome: 'sent',
      conversationId,
      messageText: decision.message_text,
      decision,
    }
  } catch (sendErr: unknown) {
    const errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
    console.error('[reactivation] error sending message via engineSendText:', sendErr)
    await db
      .from('conversations')
      .update({ ai_reactivation_status: 'failed' })
      .eq('id', conversationId)
    return { outcome: 'failed', conversationId, error: errorMsg }
  } finally {
    try {
      await db.rpc('release_ai_conversation_lock', {
        p_conversation_id: conversationId,
        p_lock_token: lockToken,
      })
    } catch {
      // Best effort release
    }
  }
}

// ============================================================
// Batch Runner for an Account
// ============================================================

export async function runContextualReactivationForAccount(
  db: SupabaseClient,
  accountId: string,
  options?: {
    now?: Date
    simulatedHours?: 'business_hours' | 'off_hours'
  },
): Promise<ReactivationRunResult> {
  const config = await loadAiConfig(db, accountId)
  if (!config || !config.isActive || !config.autoReplyEnabled) {
    return { candidates: 0, evaluated: 0, sent: 0, scheduled: 0, cancelled: 0, skipped: 0, failed: 0 }
  }

  const candidates = await findReactivationCandidates(db, accountId, {
    now: options?.now,
    limit: REACTIVATION_MAX_CANDIDATES_PER_RUN,
  })

  const result: ReactivationRunResult = {
    candidates: candidates.length,
    evaluated: 0,
    sent: 0,
    scheduled: 0,
    cancelled: 0,
    skipped: 0,
    failed: 0,
  }

  for (const candidate of candidates) {
    try {
      result.evaluated++
      const evalResult = await evaluateAndExecuteReactivation(db, candidate.id, {
        now: options?.now,
        simulatedHours: options?.simulatedHours,
        config,
      })

      switch (evalResult.outcome) {
        case 'sent':
          result.sent++
          break
        case 'scheduled_for_business_hours':
          result.scheduled++
          break
        case 'cancelled_customer_replied':
        case 'cancelled_human_assigned':
        case 'cancelled_explicit_opt_out':
          result.cancelled++
          break
        case 'skipped_not_appropriate':
        case 'skipped_spam_guard':
        case 'skipped_not_eligible':
          result.skipped++
          break
        case 'failed':
          result.failed++
          break
      }
    } catch (err) {
      console.error(`[reactivation] Error evaluating candidate ${candidate.id}:`, err)
      result.failed++
    }
  }

  return result
}
