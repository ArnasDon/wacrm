import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { aiRequestTimeoutMs } from './defaults'
import { buildLearningScanSystemPrompt, buildLearningScanUserPrompt } from './learning-prompt'
import { parseLearningScanResult, type LearningCandidate } from './learning-types'
import {
  LEARNING_INITIAL_WINDOW_DAYS,
  LEARNING_SCAN_MESSAGE_LIMIT,
  meetsLearningConfidenceThreshold,
} from './learning-config'
import type { ChatMessage } from './types'

/** Conversations considered for scanning, biased toward the most
 *  recently active ones — relevance over completeness for a
 *  periodic background job. */
const MAX_CONVERSATIONS_SCANNED = 500
/** Prompt stays bounded regardless of how big the KB/pending queue gets. */
const MAX_KNOWN_TITLES = 100
const TITLE_MAX_LENGTH = 200

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Scans one account's recent messages (since the last scan) for
 * recurring, consistent patterns worth remembering, and writes each
 * as a `pending` `ai_suggestions` row (category `learning`) — never
 * applied automatically; a human always approves/edits/rejects (see
 * PATCH /api/ai/suggestions/[id]). Never throws: a failing account
 * must not stop the cron from moving on to the next one.
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

  const { data: convRows, error: convError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .order('last_message_at', { ascending: false })
    .limit(MAX_CONVERSATIONS_SCANNED)
  if (convError) {
    console.error('[learning generate] failed to load conversations:', convError)
    return { created: 0, touched: 0 }
  }
  const conversationIds = (convRows ?? []).map((c) => c.id as string)
  if (conversationIds.length === 0) return { created: 0, touched: 0 }

  const { data: msgRows, error: msgError } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .in('conversation_id', conversationIds)
    .eq('content_type', 'text')
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(LEARNING_SCAN_MESSAGE_LIMIT)
  if (msgError) {
    console.error('[learning generate] failed to load messages:', msgError)
    return { created: 0, touched: 0 }
  }

  const rows = (msgRows ?? []) as {
    sender_type: 'customer' | 'agent' | 'bot'
    content_text: string | null
    created_at: string
  }[]
  const textRows = rows.filter((m) => m.content_text && m.content_text.trim())
  if (textRows.length === 0) {
    // Nothing to learn from, but the window itself was fully checked —
    // advance the cursor so the next run doesn't re-scan empty history.
    await db.from('ai_configs').update({ learning_last_scanned_at: new Date().toISOString() }).eq('account_id', accountId)
    return { created: 0, touched: 0 }
  }
  const messages: ChatMessage[] = textRows.map((m) => ({
    role: m.sender_type === 'customer' ? 'user' : 'assistant',
    content: m.content_text!.trim(),
  }))

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
  const userPrompt = buildLearningScanUserPrompt({ messages, knownTitles })
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages: [{ role: 'user' as const, content: userPrompt }],
    timeoutMs: aiRequestTimeoutMs(),
  }

  let candidates: LearningCandidate[] | null = null
  try {
    const { text, usage } =
      config.provider === 'openai' ? await generateOpenAi(providerArgs) : await generateAnthropic(providerArgs)
    void logAiUsage(db, {
      accountId,
      conversationId: null,
      mode: 'learning',
      provider: config.provider,
      model: config.model,
      usage,
    })
    candidates = parseLearningScanResult(text)
  } catch (err) {
    console.error('[learning generate] provider call failed:', err)
    return { created: 0, touched: 0 } // don't advance the cursor — retry this window next run
  }

  if (candidates === null) {
    console.warn('[learning generate] model output was not valid JSON — skipping this run')
    return { created: 0, touched: 0 }
  }

  let created = 0
  let touched = 0
  for (const c of candidates) {
    if (c.is_isolated) continue
    if (!meetsLearningConfidenceThreshold(c.confidence)) continue

    const title = c.info.slice(0, TITLE_MAX_LENGTH)
    const normalized = normalizeTitle(title)
    if (knownDocTitles.has(normalized)) continue // already in the KB — nothing to suggest

    const existingPending = pendingByTitle.get(normalized)
    if (existingPending) {
      const prevCount =
        typeof existingPending.payload?.occurrence_count === 'number'
          ? (existingPending.payload.occurrence_count as number)
          : 1
      await db
        .from('ai_suggestions')
        .update({
          payload: {
            ...existingPending.payload,
            occurrence_count: prevCount + c.occurrence_count,
          },
        })
        .eq('id', existingPending.id)
      touched++
      continue
    }

    const { error: insertError } = await db.from('ai_suggestions').insert({
      account_id: accountId,
      category: 'learning',
      title,
      description: c.context_summary,
      payload: {
        type: c.type,
        info: c.info,
        context_summary: c.context_summary,
        application: c.application,
        occurrence_count: c.occurrence_count,
        confidence: c.confidence,
        origin: 'Detectado automaticamente em conversas recentes',
      },
      status: 'pending',
    })
    if (insertError) {
      console.error('[learning generate] insert failed:', insertError)
      continue
    }
    created++
  }

  await db
    .from('ai_configs')
    .update({ learning_last_scanned_at: new Date().toISOString() })
    .eq('account_id', accountId)

  return { created, touched }
}
