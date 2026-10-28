import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import { aiRequestTimeoutMs } from './defaults'
import { effectiveMessageText } from './message-text'
import type { AiProvider, AiUsage, ChatMessage } from './types'
import {
  buildLeadAnalysisSystemPrompt,
  buildLeadAnalysisUserPrompt,
} from './lead-analysis-prompt'
import {
  parseLeadAnalysisResult,
  type LeadAnalysisResult,
  type LeadSummary,
  type StageSuggestion,
} from './lead-analysis-types'
import {
  LEAD_ANALYSIS_COOLDOWN_SECONDS,
  LEAD_ANALYSIS_INCREMENTAL_MESSAGE_LIMIT,
  LEAD_ANALYSIS_INITIAL_MESSAGE_LIMIT,
  PIPELINE_AUTO_MOVE_RULES,
  QUALIFIED_LEAD_MIN_SCORE,
  STAGE_SUGGESTION_MIN_SCORE,
  meetsTagConfidenceThreshold,
} from './lead-analysis-config'
import { CATEGORY_ORDER } from '@/lib/contacts/tag-categories'
import { findOrCreateTag, findTag } from '@/lib/contacts/tag-find-or-create'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { removeContactTag } from '@/lib/contacts/tag-write'
import { sendQualifiedLeadEvent } from '@/lib/whatsapp/meta-capi'
import { recalculateMatchesForLead } from '@/lib/match/service'

interface DealRef {
  id: string
  stage_id: string
}

interface StageRef {
  id: string
  name: string
}

// ============================================================
// Apply — takes an already-extracted result and writes it: silent
// tag adds/removes (section 2/13 — no human approval, no suggestion)
// plus, when the evidence clears the bar, a pipeline_move suggestion
// in ai_suggestions (never an automatic move — section 6).
//
// Split out from the provider call so it can be tested against a
// crafted `LeadAnalysisResult` without touching the network — see
// lead-analysis.test.ts.
// ============================================================

export interface ApplyLeadAnalysisArgs {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  /** Null when the contact has no open deal in any pipeline. */
  deal: DealRef | null
  /** The deal's pipeline stages, ordered by position. Ignored when `deal` is null. */
  stages: StageRef[]
  result: LeadAnalysisResult
  /** The contact's ai_score (0-10) BEFORE this analysis run. Used as a fallback
   *  when the model didn't return a lead_score in the current batch, so that
   *  pipeline auto-progression rules always have a score to evaluate against. */
  currentAiScore?: number
  /** Meta Test Events code — ONLY ever set by the manual test harness
   *  (scripts/test-qualified-lead-capi.ts). No production caller sets this,
   *  so real lead traffic never carries it. See SendQualifiedLeadOptions. */
  metaCapiTestEventCode?: string
}

export async function applyLeadAnalysisResult(args: ApplyLeadAnalysisArgs): Promise<void> {
  const { db, accountId, contactId, result } = args

  for (const change of result.tag_changes) {
    if (!meetsTagConfidenceThreshold(change.confidence)) continue
    if (!CATEGORY_ORDER.includes(change.category)) continue

    if (change.action === 'add') {
      const tagId = await findOrCreateTag(db, {
        accountId,
        name: change.name,
        category: change.category,
      })
      if (!tagId) continue
      await addContactTagAndDispatch({ db, accountId, contactId, tagId, source: 'conversation' })
    } else {
      const tagId = await findTag(db, {
        accountId,
        name: change.name,
        category: change.category,
      })
      if (!tagId) continue
      await removeContactTag(db, { accountId, contactId, tagId })
    }
  }

  await applyStageSuggestion(args)
  await applyLeadScore(args)
  await applyQualifiedLeadSignal(args)
}

// ============================================================
// QualifiedLead → Meta Conversions API — deliberately independent of
// pipeline stage. Business rule (superseding the earlier "only on
// auto-move into Interesse" version): ai_score crossing from < 7 to >= 7
// is itself the qualification signal, regardless of what stage the deal
// is in, whether a deal exists at all, or how confident the model's
// separate stage_suggestion is. Pipeline movement and the Meta signal
// are two independent facts about the same lead — this function reads
// nothing from `deal`/`stages`/`stage_suggestion` on purpose.
//
// "Crossing" (not "at or above") is what prevents re-firing on every
// later batch that keeps the lead at 8, 9, etc.: args.currentAiScore is
// always the score BEFORE this batch (passed in by the caller from the
// contact's persisted value), so once it has ever reached
// QUALIFIED_LEAD_MIN_SCORE, every subsequent batch's "before" value is
// already >= threshold and the guard below short-circuits. This also
// correctly handles a lead whose very first-ever analysis already scores
// >= 7: there is no prior row to compare against, but the caller's
// "before" default (0, see dispatchInboundToLeadAnalysis) is < 7 too, so
// the crossing is still detected — no special-casing needed.
//
// A lead that drops back below 7 and later crosses again would, under
// this same logic, attempt to send a second time. That residual case is
// intentionally left to the deterministic event_id
// (`qualified-lead:<conversationId>`, see meta-capi.ts) rather than a
// second piece of state here: Meta collapses any repeat of that same
// event_id for the same conversation, so at most one QualifiedLead is
// ever actually counted for it, however many times this function is
// (re)triggered.
// ============================================================
async function applyQualifiedLeadSignal(args: ApplyLeadAnalysisArgs): Promise<void> {
  const { db, accountId, conversationId, result } = args
  if (!result.lead_score) return // nothing new to evaluate this batch

  const scoreBefore = args.currentAiScore ?? 0
  const scoreNow = result.lead_score.value
  if (scoreBefore >= QUALIFIED_LEAD_MIN_SCORE) return // already qualified as of the prior batch
  if (scoreNow < QUALIFIED_LEAD_MIN_SCORE) return // didn't cross this batch

  try {
    if (args.metaCapiTestEventCode) {
      await sendQualifiedLeadEvent(db, accountId, conversationId, {
        testEventCode: args.metaCapiTestEventCode,
      })
    } else {
      await sendQualifiedLeadEvent(db, accountId, conversationId)
    }
  } catch (err) {
    console.error('[lead-analysis] QualifiedLead CAPI event failed:', err)
  }
}

// Score IA (migration 082) — writes contacts.ai_score/ai_score_reason/
// ai_score_updated_at from the same extraction pass that already
// produces tags, per the AGENTS task's "reuse the same reading, don't
// add a second AI call" requirement. No-op when the model didn't
// return a lead_score.
async function applyLeadScore(args: ApplyLeadAnalysisArgs): Promise<void> {
  const { db, contactId, result } = args
  if (!result.lead_score) return

  await db
    .from('contacts')
    .update({
      ai_score: result.lead_score.value,
      ai_score_reason: result.lead_score.reason,
      ai_score_updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
}

async function applyStageSuggestion(args: ApplyLeadAnalysisArgs): Promise<void> {
  const { db, accountId, contactId, conversationId, deal, stages, result } = args
  const suggestion: StageSuggestion | null = result.stage_suggestion
  if (!deal || !suggestion?.should_suggest) return
  if (suggestion.score == null || suggestion.score < STAGE_SUGGESTION_MIN_SCORE) return
  if (!suggestion.target_stage_name) return

  const targetStage = stages.find(
    (s) => s.name.trim().toLowerCase() === suggestion.target_stage_name!.trim().toLowerCase(),
  )
  // The model must reference a real stage of this pipeline — never invent one.
  if (!targetStage) return

  const fromStageName = stages.find((s) => s.id === deal.stage_id)?.name ?? '?'

  if (targetStage.id === deal.stage_id) {
    // Already there. If a stale pending suggestion proposed exactly this
    // move (e.g. an agent applied it manually before the AI caught up),
    // resolve it instead of leaving a dead "Aceitar" button around.
    const { data: existing } = await db
      .from('ai_suggestions')
      .select('id, payload')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('category', 'pipeline_move')
      .eq('status', 'pending')
      .maybeSingle()
    const payload = existing?.payload as { to_stage_id?: string } | null
    if (existing && payload?.to_stage_id === targetStage.id) {
      await db
        .from('ai_suggestions')
        .update({ status: 'done', resolved_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return
  }

  // ── Auto-progression ────────────────────────────────────────────────────
  // Moves Novo Lead → Qualificação / Interesse and Qualificação → Interesse
  // are executed automatically when the ai_score and AI confidence both meet
  // the required thresholds. Score alone is never enough — the AI must also
  // set should_suggest: true with a stage_suggestion.score ≥ STAGE_SUGGESTION_MIN_SCORE
  // (already checked above), which encodes the "evidência comercial" requirement.
  //
  // These 3 transitions never produce a pending suggestion in Central de IA:
  //   • if score qualifies → auto-move (no pending card needed)
  //   • if score insufficient → silent skip (still no pending card)
  //
  // All other transitions (→ Follow-up, backward, unrecognised) fall through
  // to the existing human-approval suggestion flow below.
  const fromLower = fromStageName.trim().toLowerCase()
  const toLower = targetStage.name.trim().toLowerCase()
  const rule = PIPELINE_AUTO_MOVE_RULES.find((r) => r.from === fromLower && r.to === toLower)

  if (rule) {
    // Effective lead warmth: prefer the freshly-computed score from this
    // analysis batch; fall back to the pre-run score when the model skipped
    // lead_score (shouldn't happen in practice, but safe default = 0 → no move).
    const aiScore = result.lead_score?.value ?? args.currentAiScore ?? 0
    if (aiScore >= rule.minAiScore) {
      // Execute the automatic stage change.
      await db.from('deals').update({ stage_id: targetStage.id }).eq('id', deal.id)
      // Resolve any stale pending pipeline_move suggestion for this lead
      // (e.g. from an earlier run that created one before auto-progression
      // was active, or a manual-accept race).
      const { data: staleSuggestion } = await db
        .from('ai_suggestions')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('category', 'pipeline_move')
        .eq('status', 'pending')
        .maybeSingle()
      if (staleSuggestion) {
        await db
          .from('ai_suggestions')
          .update({ status: 'done', resolved_at: new Date().toISOString() })
          .eq('id', staleSuggestion.id)
      }
    }
    // Whether we auto-moved or the score was insufficient, these transitions
    // must never produce a pending Central de IA suggestion — return early.
    return
  }
  // ── End auto-progression ─────────────────────────────────────────────────

  const payload = {
    deal_id: deal.id,
    from_stage_id: deal.stage_id,
    from_stage_name: fromStageName,
    to_stage_id: targetStage.id,
    to_stage_name: targetStage.name,
    score: suggestion.score,
    justification: suggestion.justification,
  }
  const title = `${fromStageName} → ${targetStage.name}`
  const description = suggestion.justification

  // At most one pending pipeline_move suggestion per lead — a fresh run
  // updates it in place rather than piling on a second one (section 7).
  const { data: existing } = await db
    .from('ai_suggestions')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('category', 'pipeline_move')
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    await db
      .from('ai_suggestions')
      .update({ title, description, payload })
      .eq('id', existing.id)
  } else {
    await db.from('ai_suggestions').insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      category: 'pipeline_move',
      title,
      description,
      payload,
      status: 'pending',
    })
  }
}

// ============================================================
// Extract — one provider call, strict-JSON-in-prompt (no provider
// JSON mode exists in this codebase's adapters, and this block must
// not add a new integration/provider — see providers/openai.ts /
// providers/anthropic.ts, both called here unmodified).
// ============================================================

interface ExtractArgs {
  provider: AiProvider
  apiKey: string
  model: string
  contactName: string
  previousSummary: LeadSummary | null
  existingTagsByCategory: Record<string, string[]>
  currentStageName: string | null
  availableStageNames: string[]
  newMessages: ChatMessage[]
  currentScore: number
}

async function extractLeadIntelligence(
  args: ExtractArgs,
): Promise<{ result: LeadAnalysisResult | null; usage: AiUsage | null }> {
  const systemPrompt = buildLeadAnalysisSystemPrompt()
  const userPrompt = buildLeadAnalysisUserPrompt({
    contactName: args.contactName,
    previousSummary: args.previousSummary,
    existingTagsByCategory: args.existingTagsByCategory,
    currentStageName: args.currentStageName,
    availableStageNames: args.availableStageNames,
    newMessages: args.newMessages,
    currentScore: args.currentScore,
  })

  const providerArgs = {
    apiKey: args.apiKey,
    model: args.model,
    systemPrompt,
    messages: [{ role: 'user' as const, content: userPrompt }],
    timeoutMs: aiRequestTimeoutMs(),
  }

  const { text, usage } =
    args.provider === 'openai'
      ? await generateOpenAi(providerArgs)
      : args.provider === 'deepseek'
        ? await generateDeepSeek(providerArgs)
        : await generateAnthropic(providerArgs)

  return { result: parseLeadAnalysisResult(text), usage }
}

// ============================================================
// Dispatch — the webhook's entry point. Mirrors dispatchInboundToAiReply's
// contract: owns its try/catch, NEVER throws, and is safe to await inside
// the webhook's after() block.
// ============================================================

interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
}

export async function dispatchInboundToLeadAnalysis(args: DispatchArgs): Promise<void> {
  const { accountId, conversationId, contactId } = args

  try {
    const db = supabaseAdmin()

    // Gate on the same account-level AI switch as everything else in
    // Settings > Agentes de IA — until a key is configured and active,
    // this is a silent no-op (per the block's "prepared to work once
    // the key is configured" instruction).
    const config = await loadAiConfig(db, accountId)
    if (!config) return

    const { data: claimed, error: claimErr } = await db.rpc('claim_lead_analysis_slot', {
      p_account_id: accountId,
      p_contact_id: contactId,
      p_cooldown_seconds: LEAD_ANALYSIS_COOLDOWN_SECONDS,
    })
    if (claimErr) {
      console.error('[lead analysis] claim_lead_analysis_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // cooldown in effect, or a concurrent run already has it

    const { data: li } = await db
      .from('lead_intelligence')
      .select('summary, last_message_id')
      .eq('contact_id', contactId)
      .maybeSingle()

    const previousSummary =
      li?.summary && Object.keys(li.summary as object).length
        ? (li.summary as LeadSummary)
        : null
    const lastMessageId: string | null = li?.last_message_id ?? null

    let sinceCreatedAt: string | null = null
    if (lastMessageId) {
      const { data: lastMsg } = await db
        .from('messages')
        .select('created_at')
        .eq('id', lastMessageId)
        .maybeSingle()
      sinceCreatedAt = lastMsg?.created_at ?? null
    }

    const limit = sinceCreatedAt
      ? LEAD_ANALYSIS_INCREMENTAL_MESSAGE_LIMIT
      : LEAD_ANALYSIS_INITIAL_MESSAGE_LIMIT

    let msgQuery = db
      .from('messages')
      .select('id, sender_type, content_type, content_text, transcript_text, created_at')
      .eq('conversation_id', conversationId)
      .in('content_type', ['text', 'audio'])
      .order('created_at', { ascending: false })
      .limit(limit)
    // >= (not >) plus an explicit id exclusion below: WhatsApp inbound
    // timestamps are second-granularity, so two messages landing in the
    // same second would collide on a strict `>` cutoff and one could be
    // silently skipped.
    if (sinceCreatedAt) msgQuery = msgQuery.gte('created_at', sinceCreatedAt)
    const { data: rawMessages, error: msgErr } = await msgQuery
    if (msgErr) {
      console.error('[lead analysis] failed to load messages:', msgErr)
      return
    }

    const rows = ((rawMessages ?? []) as {
      id: string
      sender_type: 'customer' | 'agent' | 'bot'
      content_type: string
      content_text: string | null
      transcript_text: string | null
      created_at: string
    }[])
      .filter((m) => m.id !== lastMessageId)
      .reverse() // chronological

    const textRows = rows
      .map((m) => ({ m, text: effectiveMessageText(m) }))
      .filter((r): r is { m: (typeof rows)[number]; text: string } => r.text !== null)
    if (textRows.length === 0) return // nothing new to learn from

    const newMessages: ChatMessage[] = textRows.map((r) => ({
      role: r.m.sender_type === 'customer' ? 'user' : 'assistant',
      content: r.text,
    }))
    const newestMessageId = textRows[textRows.length - 1].m.id

    const [{ data: contact }, { data: existingTags }] = await Promise.all([
      db.from('contacts').select('name, ai_score').eq('id', contactId).maybeSingle(),
      db
        .from('tags')
        .select('name, category')
        .eq('account_id', accountId)
        .in('category', CATEGORY_ORDER as unknown as string[]),
    ])
    const contactName = contact?.name || 'Lead'
    const currentScore = contact?.ai_score ?? 0

    const existingTagsByCategory: Record<string, string[]> = {}
    for (const t of (existingTags ?? []) as { name: string; category: string | null }[]) {
      if (!t.category) continue
      ;(existingTagsByCategory[t.category] ??= []).push(t.name)
    }

    const { data: dealRow } = await db
      .from('deals')
      .select('id, stage_id, pipeline_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    let stages: StageRef[] = []
    let currentStageName: string | null = null
    let deal: DealRef | null = null
    if (dealRow) {
      deal = { id: dealRow.id, stage_id: dealRow.stage_id }
      const { data: stageRows } = await db
        .from('pipeline_stages')
        .select('id, name')
        .eq('pipeline_id', dealRow.pipeline_id)
        .order('position', { ascending: true })
      stages = (stageRows ?? []) as StageRef[]
      currentStageName = stages.find((s) => s.id === dealRow.stage_id)?.name ?? null
    }

    let extraction: { result: LeadAnalysisResult | null; usage: AiUsage | null }
    try {
      const activeKey =
        config.provider === 'deepseek'
          ? (config.deepseekApiKey || config.apiKey)
          : config.apiKey
      extraction = await extractLeadIntelligence({
        provider: config.provider,
        apiKey: activeKey,
        model: config.model,
        contactName,
        previousSummary,
        existingTagsByCategory,
        currentStageName,
        availableStageNames: stages.map((s) => s.name),
        newMessages,
        currentScore,
      })
    } catch (err) {
      console.error('[lead analysis] provider call failed:', err)
      return
    }

    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'lead_analysis',
      provider: config.provider,
      model: config.model,
      usage: extraction.usage,
    })

    if (!extraction.result) {
      console.warn('[lead analysis] model output was not valid JSON — skipping this run')
      return
    }

    await applyLeadAnalysisResult({
      db,
      accountId,
      contactId,
      conversationId,
      deal,
      stages,
      result: extraction.result,
      currentAiScore: currentScore,
    })

    await db
      .from('lead_intelligence')
      .update({
        summary: extraction.result.summary,
        last_message_id: newestMessageId,
        last_analyzed_at: new Date().toISOString(),
      })
      .eq('contact_id', contactId)

    // Recalcula os Matches determinísticos do lead com base no novo perfil
    try {
      await recalculateMatchesForLead(db, accountId, contactId)
    } catch (matchErr) {
      console.error('[lead analysis] recalculateMatchesForLead failed:', matchErr)
    }
  } catch (err) {
    console.error('[lead analysis] dispatch failed:', err)
  }
}
