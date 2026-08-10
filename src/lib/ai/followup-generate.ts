import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { aiRequestTimeoutMs } from './defaults'
import {
  buildFollowupScoreSystemPrompt,
  buildFollowupScoreUserPrompt,
} from './followup-prompt'
import { parseFollowupScoreResult } from './followup-types'
import type { LeadSummary } from './lead-analysis-types'
import {
  FOLLOWUP_MAX_CANDIDATES_PER_RUN,
  FOLLOWUP_MIN_HOURS_SINCE_CONTACT,
  FOLLOWUP_MIN_SCORE,
} from './followup-config'

interface CandidateDeal {
  id: string
  contact_id: string | null
  conversation_id: string | null
  stage_id: string
  pipeline_id: string
  contact: { name: string; has_purchased: boolean } | null
  conversation: { last_message_at: string | null } | null
}

/**
 * Scans one account for conversations that have gone quiet and don't
 * already have a pending follow-up suggestion, scores each candidate
 * with a small (conversation-free — see followup-prompt.ts) AI call
 * against the persisted BLOCO 2/4 lead summary, and writes a
 * `pending` `ai_suggestions` row (category `followup`) for the ones
 * that clear the score bar. Never throws — errors are logged and the
 * run just processes fewer candidates; a bad account must not stop
 * the cron from moving on to the next one.
 */
export async function generateFollowupSuggestions(
  db: SupabaseClient,
  accountId: string,
): Promise<{ created: number; scored: number }> {
  const config = await loadAiConfig(db, accountId)
  if (!config) return { created: 0, scored: 0 }

  const cutoff = new Date(
    Date.now() - FOLLOWUP_MIN_HOURS_SINCE_CONTACT * 60 * 60 * 1000,
  ).toISOString()

  const { data: dealRows, error: dealsError } = await db
    .from('deals')
    .select(
      'id, contact_id, conversation_id, stage_id, pipeline_id, contact:contacts(name, has_purchased), conversation:conversations(last_message_at)',
    )
    .eq('account_id', accountId)
    .eq('status', 'open')
  if (dealsError) {
    console.error('[followup generate] failed to load deals:', dealsError)
    return { created: 0, scored: 0 }
  }

  const candidates = ((dealRows ?? []) as unknown as CandidateDeal[]).filter(
    (d) =>
      d.contact_id &&
      d.conversation_id &&
      d.contact &&
      (!d.conversation?.last_message_at || d.conversation.last_message_at < cutoff),
  )
  if (candidates.length === 0) return { created: 0, scored: 0 }

  // Exclude contacts that already have a pending follow-up — a fresh
  // suggestion for the same lead only happens after the old one is
  // resolved (done/ignored), never piled on top of it.
  const contactIds = candidates.map((d) => d.contact_id as string)
  const { data: pendingRows } = await db
    .from('ai_suggestions')
    .select('contact_id')
    .eq('account_id', accountId)
    .eq('category', 'followup')
    .eq('status', 'pending')
    .in('contact_id', contactIds)
  const alreadyPending = new Set((pendingRows ?? []).map((r) => r.contact_id as string))

  const toScore = candidates
    .filter((d) => !alreadyPending.has(d.contact_id as string))
    .slice(0, FOLLOWUP_MAX_CANDIDATES_PER_RUN)
  if (toScore.length === 0) return { created: 0, scored: 0 }

  const stageIds = [...new Set(toScore.map((d) => d.stage_id))]
  const { data: stageRows } = await db
    .from('pipeline_stages')
    .select('id, name')
    .in('id', stageIds)
  const stageNameById = new Map((stageRows ?? []).map((s) => [s.id as string, s.name as string]))

  const { data: liRows } = await db
    .from('lead_intelligence')
    .select('contact_id, summary')
    .in('contact_id', toScore.map((d) => d.contact_id as string))
  const summaryByContact = new Map(
    (liRows ?? []).map((r) => [
      r.contact_id as string,
      Object.keys((r.summary as object) ?? {}).length
        ? (r.summary as LeadSummary)
        : null,
    ]),
  )

  const systemPrompt = buildFollowupScoreSystemPrompt()
  let created = 0
  let scored = 0

  for (const deal of toScore) {
    const contactId = deal.contact_id as string
    const conversationId = deal.conversation_id as string
    const lastContactAt = deal.conversation?.last_message_at
    const hoursSince = lastContactAt
      ? (Date.now() - new Date(lastContactAt).getTime()) / (60 * 60 * 1000)
      : FOLLOWUP_MIN_HOURS_SINCE_CONTACT

    const userPrompt = buildFollowupScoreUserPrompt({
      contactName: deal.contact?.name || 'Lead',
      hasPurchased: deal.contact?.has_purchased ?? false,
      currentStageName: stageNameById.get(deal.stage_id) ?? null,
      hoursSinceLastContact: hoursSince,
      summary: summaryByContact.get(contactId) ?? null,
    })

    const providerArgs = {
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt,
      messages: [{ role: 'user' as const, content: userPrompt }],
      timeoutMs: aiRequestTimeoutMs(),
    }

    try {
      const { text, usage } =
        config.provider === 'openai'
          ? await generateOpenAi(providerArgs)
          : await generateAnthropic(providerArgs)
      scored++

      void logAiUsage(db, {
        accountId,
        conversationId,
        mode: 'followup',
        provider: config.provider,
        model: config.model,
        usage,
      })

      const result = parseFollowupScoreResult(text)
      if (!result?.should_suggest || result.score === null || result.score < FOLLOWUP_MIN_SCORE) {
        continue
      }

      const { error: insertError } = await db.from('ai_suggestions').insert({
        account_id: accountId,
        contact_id: contactId,
        conversation_id: conversationId,
        category: 'followup',
        title: result.reason,
        description: result.approach_summary,
        payload: {
          stage_name: stageNameById.get(deal.stage_id) ?? null,
          has_purchased: deal.contact?.has_purchased ?? false,
          hours_since_contact: Math.round(hoursSince),
          reason: result.reason,
          approach_summary: result.approach_summary,
          score: result.score,
        },
        status: 'pending',
      })
      if (insertError) {
        console.error('[followup generate] insert failed:', insertError)
        continue
      }
      created++
    } catch (err) {
      console.error('[followup generate] scoring failed for contact', contactId, err)
    }
  }

  return { created, scored }
}
