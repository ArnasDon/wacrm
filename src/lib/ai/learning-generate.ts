import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import { aiRequestTimeoutMs } from './defaults'
import { buildLearningScanSystemPrompt, buildLearningScanUserPrompt, type LearningScanMessage } from './learning-prompt'
import { parseLearningScanResult, type LearningCandidate, type LearningConfidence } from './learning-types'
import {
  LEARNING_INITIAL_WINDOW_DAYS,
  LEARNING_SCAN_MESSAGE_LIMIT,
  LEARNING_SCAN_MAX_OUTPUT_TOKENS,
  meetsLearningConfidenceThreshold,
} from './learning-config'
import { effectiveMessageText } from './message-text'
import {
  AUTO_APPLY_MIN_OCCURRENCES,
  applyPropertySubjectiveLearning,
  meetsAutoApplyThreshold,
} from './property-learning-apply'
import {
  findConversationEvidence,
  recordPropertyLearningEvidence,
  resolvePropertyIdentity,
} from './property-identity'
import { inferScopeFromKnowledgeType, type MemoryKnowledgeType, type MemoryScope } from './memory'
import { consolidateMemory } from './memory-consolidation'
import type { AiConfig } from './types'

/** Prompt stays bounded regardless of how big the KB/pending queue gets. */
const MAX_KNOWN_TITLES = 100
const TITLE_MAX_LENGTH = 200

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase()
}

interface MessageRow {
  id: string
  conversation_id: string
  sender_type: 'customer' | 'agent' | 'bot'
  sender_id: string | null
  content_type: string
  content_text: string | null
  transcript_text: string | null
  created_at: string
  conversations: {
    account_id: string
    property_id: string | null
    contact_id: string | null
    ctwa_referral: { source_id?: string } | null
    properties: { name: string } | null
  }
}

/** First name only ("Ronaldo Meira" → "Ronaldo") — matches how the scan
 *  prompt's own examples refer to corretores, and keeps transcript lines
 *  short. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName
}

/** Resolves a model-reported `agent_name` ("Ronaldo", "Thatianna Oliveira"...)
 *  back to the account's real profile — case-insensitive match against
 *  either the first name or the full name. Returns null (never a guess)
 *  when it doesn't clearly match exactly one profile: an unattributed
 *  style memory (agent_id: null, "the team in general") is always safer
 *  than misattributing Thatianna's phrasing to Ronaldo. */
function resolveAgentIdByName(
  agentName: string | null | undefined,
  profiles: { user_id: string; full_name: string }[],
): string | null {
  if (!agentName) return null
  const needle = agentName.trim().toLowerCase()
  if (!needle) return null
  const matches = profiles.filter(
    (p) => p.full_name.toLowerCase() === needle || firstName(p.full_name).toLowerCase() === needle,
  )
  return matches.length === 1 ? matches[0].user_id : null
}

/**
 * Scans one account's recent messages (since the last scan) for
 * recurring, consistent patterns worth remembering, and writes each
 * as a `pending` `ai_suggestions` row (category `learning`) — never
 * applied automatically; a human always approves/edits/rejects (see
 * PATCH /api/ai/suggestions/[id]), except the narrow, pre-existing
 * property_subjective auto-apply path below. Never throws: a failing
 * account must not stop the cron from moving on to the next one.
 *
 * Idempotent, backlog-safe cursor: `learning_last_scanned_at` only ever
 * advances to the `created_at` of the LAST message actually read in this
 * run — never to "now" — so a batch capped by LEARNING_SCAN_MESSAGE_LIMIT
 * never silently skips the overflow (it's read on the next run instead),
 * and a batch whose model output fails to parse still moves forward
 * instead of retrying the exact same (deterministically failing) window
 * forever.
 */
export async function generateLearningSuggestions(
  db: SupabaseClient,
  accountId: string,
): Promise<{ created: number; touched: number }> {
  const config = await loadAiConfig(db, accountId)
  if (!config) return { created: 0, touched: 0 }

  const { data: configRow } = await db
    .from('ai_configs')
    .select('learning_last_scanned_at')
    .eq('account_id', accountId)
    .maybeSingle()
  const since =
    (configRow?.learning_last_scanned_at as string | null) ??
    new Date(Date.now() - LEARNING_INITIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Scoped to the account via an inner join on conversations rather than
  // prefetching conversation ids into an `.in()` list: with hundreds of
  // conversations, that list alone pushed the request URL past PostgREST's
  // ~16KB header limit (HeadersOverflowError), silently breaking this scan.
  const { data: msgRows, error: msgError } = await db
    .from('messages')
    .select(
      'id, conversation_id, sender_type, sender_id, content_type, content_text, transcript_text, created_at, conversations!inner(account_id, property_id, contact_id, ctwa_referral, properties(name))',
    )
    .eq('conversations.account_id', accountId)
    .in('content_type', ['text', 'audio'])
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(LEARNING_SCAN_MESSAGE_LIMIT)
  if (msgError) {
    console.error('[learning generate] failed to load messages:', msgError)
    return { created: 0, touched: 0 }
  }

  const rows = (msgRows ?? []) as unknown as MessageRow[]
  const textRows = rows
    .map((m) => ({ m, text: effectiveMessageText(m) }))
    .filter((r): r is { m: MessageRow; text: string } => r.text !== null)
  if (textRows.length === 0) {
    // Nothing to learn from, but the window itself was fully checked —
    // advance the cursor so the next run doesn't re-scan empty history.
    // Safe to jump to "now" here specifically: an empty read means there
    // was nothing between `since` and now to begin with, so there's
    // nothing to skip.
    await db.from('ai_configs').update({ learning_last_scanned_at: new Date().toISOString() }).eq('account_id', accountId)
    return { created: 0, touched: 0 }
  }

  // The cursor for THIS run, regardless of what happens below (parse
  // failure included) — the exact created_at of the last message actually
  // read. Messages past LEARNING_SCAN_MESSAGE_LIMIT stay > this cursor and
  // get picked up next run; nothing already read here is ever re-read.
  const nextCursor = textRows[textRows.length - 1].m.created_at

  const { data: profileRows } = await db.from('profiles').select('user_id, full_name').eq('account_id', accountId)
  const profiles = (profileRows ?? []) as { user_id: string; full_name: string }[]
  const profileByUserId = new Map(profiles.map((p) => [p.user_id, p.full_name]))

  function speakerFor(m: MessageRow): { role: LearningScanMessage['speakerRole']; label: string } {
    if (m.sender_type === 'customer') return { role: 'cliente', label: 'Cliente' }
    if (m.sender_type === 'bot') return { role: 'clara', label: 'Clara' }
    const name = m.sender_id ? profileByUserId.get(m.sender_id) : null
    return name ? { role: 'ronaldo_ou_tatianna', label: firstName(name) } : { role: 'outro_atendente', label: 'Atendente' }
  }

  const scanMessages: LearningScanMessage[] = textRows.map(({ m, text }) => {
    const speaker = speakerFor(m)
    return {
      conversationId: m.conversation_id,
      propertyName: m.conversations.properties?.name ?? null,
      adId: m.conversations.ctwa_referral?.source_id ?? null,
      speakerRole: speaker.role,
      speakerLabel: speaker.label,
      text,
    }
  })

  // Anti-hallucination guards: an ad_id/conversation_id the model reports
  // must be one it actually saw in this batch — never trusted blindly,
  // since a fabricated id would otherwise let a candidate through
  // resolveScope below with a syntactically valid but meaningless target.
  const knownAdIds = new Set(scanMessages.map((m) => m.adId).filter((v): v is string => Boolean(v)))
  const knownConversationIds = new Set(scanMessages.map((m) => m.conversationId))
  const contactIdByConversation = new Map(
    textRows.map((r) => [r.m.conversation_id, r.m.conversations.contact_id] as const),
  )

  // Whether ANY message informing this batch came from a transcribed
  // voice note (customer or agent) — tags every memory this run produces
  // as (partly) audio-derived. A per-candidate attribution isn't possible:
  // the model reasons over the whole batch, not one message at a time.
  const hasAudioEvidence = textRows.some((r) => r.m.content_type === 'audio')

  const [{ data: docRows }, { data: pendingRows }] = await Promise.all([
    db.from('ai_knowledge_documents').select('title').eq('account_id', accountId).limit(MAX_KNOWN_TITLES),
    db
      .from('ai_suggestions')
      .select('id, title, payload')
      .eq('account_id', accountId)
      .eq('category', 'learning')
      .eq('status', 'pending')
      .limit(MAX_KNOWN_TITLES),
  ])
  const knownDocTitles = new Set((docRows ?? []).map((d) => normalizeTitle(d.title as string)))
  const pendingByTitle = new Map(
    ((pendingRows ?? []) as { id: string; title: string; payload: Record<string, unknown> }[]).map(
      (r) => [normalizeTitle(r.title), r],
    ),
  )
  const knownTitles = [
    ...(docRows ?? []).map((d) => d.title as string),
    ...(pendingRows ?? []).map((r) => r.title as string),
  ].slice(0, MAX_KNOWN_TITLES)

  const systemPrompt = buildLearningScanSystemPrompt()
  const userPrompt = buildLearningScanUserPrompt({ messages: scanMessages, knownTitles })
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
    // The learning scan can legitimately produce many candidates in one
    // batch — the shared conversational MAX_OUTPUT_TOKENS (1024, sized for
    // a short WhatsApp reply) was silently truncating this response
    // mid-JSON on any batch with more than a handful of learnings,
    // permanently stalling the cursor (every retry re-read the exact same
    // over-limit batch and got cut off the same way). See defaults.ts.
    maxOutputTokens: LEARNING_SCAN_MAX_OUTPUT_TOKENS,
    // Also forces syntactically valid JSON (OpenAI json_object mode /
    // Anthropic "{" prefill) instead of relying on the model to
    // spontaneously avoid prose or markdown fences.
    structuredOutputRequired: true,
  }

  let candidates: LearningCandidate[] | null = null
  try {
    const { text, usage } =
      config.provider === 'openai'
        ? await generateOpenAi(providerArgs)
        : config.provider === 'deepseek'
          ? await generateDeepSeek(providerArgs)
          : await generateAnthropic(providerArgs)
    void logAiUsage(db, {
      accountId,
      conversationId: null,
      mode: 'learning',
      provider: config.provider,
      model: config.model,
      usage,
    })
    candidates = parseLearningScanResult(text)
    if (candidates === null) {
      console.warn(
        '[learning generate] model output was not valid JSON — advancing cursor anyway (idempotent backlog recovery), snippet:',
        text.slice(0, 300),
      )
    }
  } catch (err) {
    console.error('[learning generate] provider call failed — will retry this exact window next run:', err)
    // A transient provider error (timeout, rate limit, network) is worth
    // retrying against the SAME window — unlike a parse failure, nothing
    // was actually read from the model, so there's no risk of an
    // infinite, deterministic re-failure on the same content.
    return { created: 0, touched: 0 }
  }

  // Lazily resolved account owner — only needed the first time a
  // property_subjective learning actually crosses the auto-apply
  // threshold and might need to auto-create a provisional property.
  let ownerUserId: string | null | undefined
  async function getOwnerUserId(): Promise<string | null> {
    if (ownerUserId === undefined) {
      const { data } = await db.from('accounts').select('owner_user_id').eq('id', accountId).maybeSingle()
      ownerUserId = (data?.owner_user_id as string | null) ?? null
    }
    return ownerUserId
  }

  /**
   * A `property_subjective` learning that's high-confidence, non-isolated
   * (guaranteed by the `c.is_isolated` filter above), and recurring enough
   * (>= AUTO_APPLY_MIN_OCCURRENCES) gets applied immediately instead of
   * waiting for manual review — same pipeline as approving it by hand
   * (suggestions/[id]/route.ts), so a subsequent revert works identically
   * either way.
   *
   * Every other scoped-memory type (business_rule, company_fact,
   * property_fact, ad_fact, client_preference, ...) also auto-applies, via
   * consolidateMemory instead of a manual PATCH approve — common knowledge
   * from Ronaldo/Tatiana/clientes/anúncios enters as evidence without a
   * human clicking approve (memory-consolidation.ts's own candidate/active
   * confidence ladder is what keeps a single stray mention from being
   * treated as fact, not this gate). Human approval stays required only
   * for the types that never had a scope to begin with (never_rule,
   * language_style, boundary_suggestion, process_suggestion,
   * global_knowledge — behavior/policy changes, not knowledge) and for the
   * genuinely ambiguous case a scope's target can't be resolved safely
   * (unknown property name, unrecognized ad/conversation id) — see
   * tryAutoConsolidate below.
   */
  async function tryAutoApply(
    payload: Record<string, unknown>,
  ): Promise<{ approved: boolean; extra: Record<string, unknown> }> {
    if (payload.type === 'property_subjective') {
      const candidate = {
        confidence: payload.confidence as LearningConfidence,
        is_isolated: false,
        occurrence_count: (payload.occurrence_count as number) || 0,
      }
      if (!meetsAutoApplyThreshold(candidate)) return { approved: false, extra: {} }

      const owner = await getOwnerUserId()
      if (!owner) return { approved: false, extra: {} }

      try {
        const applied = await applyPropertySubjectiveLearning(db, accountId, config as AiConfig, owner, {
          propertyName: (payload.property_name as string | null) ?? null,
          info: payload.info as string,
        })
        if (!applied) return { approved: false, extra: {} }
        return {
          approved: true,
          extra: {
            applied_target: 'property_subjective',
            applied_property_id: applied.propertyId,
            previous_subjective_knowledge: applied.previousKnowledge,
            auto_applied: true,
            auto_applied_reason: `occurrence_count >= ${AUTO_APPLY_MIN_OCCURRENCES}, confidence high, is_isolated false`,
          },
        }
      } catch (err) {
        console.error('[learning generate] auto-apply failed:', err)
        return { approved: false, extra: {} }
      }
    }

    // 'language_style' resolves to scope "global" (it's a STYLE_KNOWLEDGE_TYPE
    // in memory.ts) but suggestions/[id]/route.ts deliberately special-cases
    // it to ai_configs.team_presentation instead of ai_memories — auto-apply
    // must mirror that exact routing, not just "has a scope", or the two
    // paths would send the same learning type to two different homes.
    const scope = payload.scope as MemoryScope | null
    if (scope && payload.type !== 'language_style') return tryAutoConsolidate(payload, scope)

    return { approved: false, extra: {} }
  }

  /**
   * Auto-consolidates one scoped-memory candidate straight into
   * ai_memories via consolidateMemory — no ai_suggestions pending state,
   * no admin click. Declines (falls back to a 'pending' suggestion for a
   * human to resolve) only when the scope's required target id isn't
   * something this scan can trust (property name didn't resolve to a
   * single safe match, ad/conversation id wasn't one actually seen in this
   * batch) — a genuine business-decision ambiguity, not something to guess.
   */
  async function tryAutoConsolidate(
    payload: Record<string, unknown>,
    scope: MemoryScope,
  ): Promise<{ approved: boolean; extra: Record<string, unknown> }> {
    const propertyId = (payload.property_id as string | null) ?? null
    const adId = (payload.ad_id as string | null) ?? null
    const conversationId = (payload.conversation_id as string | null) ?? null
    const contactId = (payload.contact_id as string | null) ?? null
    const agentId = (payload.agent_id as string | null) ?? null
    const learningType = payload.type as MemoryKnowledgeType
    const info = typeof payload.info === 'string' ? payload.info.trim() : ''
    if (!info) return { approved: false, extra: {} }

    if (scope === 'property' && !propertyId) return { approved: false, extra: {} }
    if (scope === 'ad' && !adId) return { approved: false, extra: {} }
    if (scope === 'conversation' && !conversationId) return { approved: false, extra: {} }

    const title = info.slice(0, TITLE_MAX_LENGTH)
    // Evidence independence keys off the conversation when this candidate
    // is tied to one (matches how a human approval's evidence is keyed —
    // see suggestions/[id]/route.ts). GLOBAL/PROPERTY candidates the model
    // didn't attribute to one specific conversation instead key off this
    // scan run: two different scan runs are, by construction, two
    // temporally distinct observations, which is exactly what "independent
    // evidence" means here.
    const evidence = conversationId
      ? ({ kind: 'conversation', conversationId } as const)
      : ({ kind: 'message', messageId: `learning-scan:${nextCursor}:${normalizeTitle(title)}` } as const)

    try {
      const result = await consolidateMemory(db, {
        accountId,
        scope,
        knowledgeType: learningType,
        title,
        content: info,
        propertyId,
        adId,
        conversationId,
        contactId,
        agentId,
        sourceType: hasAudioEvidence ? 'audio_transcript' : 'learning_scan',
        evidence,
        metadata: { learning_origin: 'auto_consolidated' },
      })
      if (!result.memory) return { approved: false, extra: {} } // low-signal content — nothing to apply

      return {
        approved: true,
        extra: {
          applied_target: `memory:${scope}`,
          applied_memory_id: result.memory.id,
          applied_memory_status: result.memory.status,
          consolidation_action: result.action,
          auto_applied: true,
          auto_applied_reason: 'common_knowledge_auto_consolidated',
        },
      }
    } catch (err) {
      console.error('[learning generate] auto-consolidate failed:', err)
      return { approved: false, extra: {} }
    }
  }

  // Raw scanned messages, grouped by conversation — feeds the
  // conversation-evidence ledger below. Kept separate from `scanMessages`
  // since evidence must be counted per distinct conversation using the
  // raw text, not the speaker-labeled transcript line.
  const evidenceRows = textRows.map((r) => ({ conversationId: r.m.conversation_id, text: r.text }))

  /**
   * Every `property_subjective` candidate with a name accrues
   * conversation evidence toward the "is this a real, recurring
   * empreendimento" bar — regardless of this scan's own is_isolated/
   * confidence verdict, since a name flagged isolated in one batch can
   * still be genuinely recurring once several batches are combined.
   * Skipped entirely once the name already resolves to an existing
   * property (`safe_match`) — nothing left to prove for it — or is
   * `ambiguous` between multiple existing properties, since evidence
   * accumulated under an ambiguous name must never be allowed to spawn
   * a new property; only a genuine `no_match` accrues evidence.
   */
  async function maybeRecordPropertyEvidence(c: LearningCandidate): Promise<void> {
    if (c.type !== 'property_subjective' || !c.property_name) return
    try {
      const resolution = await resolvePropertyIdentity(db, accountId, c.property_name)
      if (resolution.kind !== 'no_match') return
      const { mentioned, withContext } = findConversationEvidence(evidenceRows, c.property_name)
      if (mentioned.size === 0) return
      await recordPropertyLearningEvidence(db, accountId, c.property_name, mentioned, withContext)
    } catch (err) {
      console.error('[learning generate] failed to record property evidence:', err)
    }
  }

  /**
   * For a scoped candidate (everything routed to ai_memories once
   * approved — see suggestions/[id]/route.ts), resolves and validates the
   * target id the candidate's scope requires, or returns null when it
   * can't be trusted — in which case the caller must still create the
   * suggestion (a human can fix the target during review) but never with
   * a fabricated id.
   */
  async function resolveScopeTarget(
    scope: MemoryScope,
    c: LearningCandidate,
  ): Promise<{ propertyId: string | null; adId: string | null; conversationId: string | null; contactId: string | null }> {
    if (scope === 'property') {
      if (!c.property_name) return { propertyId: null, adId: null, conversationId: null, contactId: null }
      const resolution = await resolvePropertyIdentity(db, accountId, c.property_name)
      return {
        propertyId: resolution.kind === 'safe_match' ? resolution.propertyId : null,
        adId: null,
        conversationId: null,
        contactId: null,
      }
    }
    if (scope === 'ad') {
      const adId = c.ad_id && knownAdIds.has(c.ad_id) ? c.ad_id : null
      return { propertyId: null, adId, conversationId: null, contactId: null }
    }
    if (scope === 'conversation') {
      const conversationId = c.conversation_id && knownConversationIds.has(c.conversation_id) ? c.conversation_id : null
      return {
        propertyId: null,
        adId: null,
        conversationId,
        contactId: conversationId ? contactIdByConversation.get(conversationId) ?? null : null,
      }
    }
    return { propertyId: null, adId: null, conversationId: null, contactId: null }
  }

  let created = 0
  let touched = 0
  for (const c of candidates ?? []) {
    await maybeRecordPropertyEvidence(c)

    if (c.is_isolated) continue
    if (!meetsLearningConfidenceThreshold(c.confidence)) continue

    const title = c.info.slice(0, TITLE_MAX_LENGTH)
    const normalized = normalizeTitle(title)
    if (knownDocTitles.has(normalized)) continue // already in the KB — nothing to suggest

    const scope = inferScopeFromKnowledgeType(c.type)
    const isNewScopedType = scope !== null && c.type !== 'property_subjective'
    const target = isNewScopedType
      ? await resolveScopeTarget(scope as MemoryScope, c)
      : { propertyId: null, adId: null, conversationId: null, contactId: null }
    const agentId = isNewScopedType ? resolveAgentIdByName(c.agent_name, profiles) : null

    const existingPending = pendingByTitle.get(normalized)
    if (existingPending) {
      const prevCount =
        typeof existingPending.payload?.occurrence_count === 'number'
          ? (existingPending.payload.occurrence_count as number)
          : 1
      const mergedPayload = {
        ...existingPending.payload,
        occurrence_count: prevCount + c.occurrence_count,
        property_name: existingPending.payload?.property_name ?? c.property_name ?? null,
      }
      const { approved, extra } = await tryAutoApply(mergedPayload)
      const update: Record<string, unknown> = { payload: { ...mergedPayload, ...extra } }
      if (approved) {
        update.status = 'approved'
        update.resolved_at = new Date().toISOString()
        update.resolved_by = null
      }
      await db.from('ai_suggestions').update(update).eq('id', existingPending.id)
      touched++
      continue
    }

    const basePayload = {
      type: c.type,
      scope,
      info: c.info,
      context_summary: c.context_summary,
      application: c.application,
      occurrence_count: c.occurrence_count,
      confidence: c.confidence,
      property_name: c.property_name ?? null,
      property_id: target.propertyId,
      ad_id: target.adId,
      conversation_id: target.conversationId,
      contact_id: target.contactId,
      agent_name: c.agent_name ?? null,
      agent_id: agentId,
      origin_includes_audio: hasAudioEvidence,
      origin: 'Detectado automaticamente em conversas recentes',
    }
    const { approved, extra } = await tryAutoApply(basePayload)

    const { error: insertError } = await db.from('ai_suggestions').insert({
      account_id: accountId,
      category: 'learning',
      title,
      description: c.context_summary,
      payload: { ...basePayload, ...extra },
      status: approved ? 'approved' : 'pending',
      ...(approved ? { resolved_at: new Date().toISOString(), resolved_by: null } : {}),
    })
    if (insertError) {
      console.error('[learning generate] insert failed:', insertError)
      continue
    }
    created++
  }

  await db.from('ai_configs').update({ learning_last_scanned_at: nextCursor }).eq('account_id', accountId)

  return { created, touched }
}
