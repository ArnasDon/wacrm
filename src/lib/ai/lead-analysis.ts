import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { aiRequestTimeoutMs } from './defaults'
import type { AiUsage, ChatMessage } from './types'
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
  STAGE_SUGGESTION_MIN_SCORE,
  meetsTagConfidenceThreshold,
} from './lead-analysis-config'
import { CATEGORY_ORDER } from '@/lib/contacts/tag-categories'
import { findOrCreateTag, findTag } from '@/lib/contacts/tag-find-or-create'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { removeContactTag } from '@/lib/contacts/tag-write'

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
      await addContactTagAndDispatch({ db, accountId, contactId, tagId })
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

  const fromStageName = stages.find((s) => s.id === deal.stage_id)?.name ?? '?'
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
  provider: 'openai' | 'anthropic'
  apiKey: string
  model: string
  contactName: string
  previousSummary: LeadSummary | null
  existingTagsByCategory: Record<string, string[]>
  currentStageName: string | null
  availableStageNames: string[]
  newMessages: ChatMessage[]
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
      .select('id, sender_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .eq('content_type', 'text')
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
      content_text: string | null
      created_at: string
    }[])
      .filter((m) => m.id !== lastMessageId)
      .reverse() // chronological

    const textRows = rows.filter((m) => m.content_text && m.content_text.trim())
    if (textRows.length === 0) return // nothing new to learn from

    const newMessages: ChatMessage[] = textRows.map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
    }))
    const newestMessageId = textRows[textRows.length - 1].id

    const [{ data: contact }, { data: existingTags }] = await Promise.all([
      db.from('contacts').select('name').eq('id', contactId).maybeSingle(),
      db
        .from('tags')
        .select('name, category')
        .eq('account_id', accountId)
        .in('category', CATEGORY_ORDER as unknown as string[]),
    ])
    const contactName = contact?.name || 'Lead'

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
      extraction = await extractLeadIntelligence({
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        contactName,
        previousSummary,
        existingTagsByCategory,
        currentStageName,
        availableStageNames: stages.map((s) => s.name),
        newMessages,
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
    })

    await db
      .from('lead_intelligence')
      .update({
        summary: extraction.result.summary,
        last_message_id: newestMessageId,
        last_analyzed_at: new Date().toISOString(),
      })
      .eq('contact_id', contactId)
  } catch (err) {
    console.error('[lead analysis] dispatch failed:', err)
  }
}
