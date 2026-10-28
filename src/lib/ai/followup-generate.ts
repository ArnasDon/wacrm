import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { logAiUsage } from './usage'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import { aiRequestTimeoutMs } from './defaults'
import {
  buildFollowupScoreSystemPrompt,
  buildFollowupScoreUserPrompt,
} from './followup-prompt'
import { parseFollowupScoreResult } from './followup-types'
import type { LeadSummary } from './lead-analysis-types'
import {
  FOLLOWUP_MAX_CANDIDATES_PER_RUN,
  FOLLOWUP_MAX_SENDS_PER_RUN,
  FOLLOWUP_MIN_HOURS_SINCE_CONTACT,
  FOLLOWUP_MIN_SCORE,
} from './followup-config'
import { engineSendTemplate } from '@/lib/automations/meta-send'

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
  //
  // Batch the check in chunks of 50 to prevent PostgREST URL overflow
  // (HTTP 414 / HeadersOverflowError) when an account has hundreds of
  // stale candidates. Uses the get_pending_followup_contact_ids RPC
  // with SELECT DISTINCT to avoid row truncation (PostgREST 1000-row limit)
  // caused by historical duplicate backlogs. Explicitly checks errors so a DB
  // failure never looks like "zero pending", and early-exits as soon as enough
  // un-pending candidates are gathered for this run (FOLLOWUP_MAX_CANDIDATES_PER_RUN).
  const CHUNK_SIZE = 50
  const uniqueCandidateContacts = Array.from(
    new Set(candidates.map((d) => d.contact_id as string)),
  )

  const alreadyPending = new Set<string>()
  const toScore: CandidateDeal[] = []
  const seenInToScore = new Set<string>()

  for (let i = 0; i < uniqueCandidateContacts.length; i += CHUNK_SIZE) {
    const chunk = uniqueCandidateContacts.slice(i, i + CHUNK_SIZE)

    // Primary: use RPC with DISTINCT to avoid 1000-row PostgREST ceiling
    const hasRpc = typeof db.rpc === 'function'
    const { data: rpcRows, error: rpcErr } = hasRpc
      ? await db.rpc('get_pending_followup_contact_ids', {
          p_account_id: accountId,
          p_contact_ids: chunk,
        })
      : { data: null, error: { message: 'rpc not available' } }

    if (rpcErr) {
      // Fallback if RPC is not yet registered: direct query with error check
      const { data: pendingRows, error: pendingErr } = await db
        .from('ai_suggestions')
        .select('contact_id')
        .eq('account_id', accountId)
        .eq('category', 'followup')
        .eq('status', 'pending')
        .in('contact_id', chunk)

      if (pendingErr) {
        console.error('[followup generate] failed to check pending suggestions:', pendingErr)
        return { created: 0, scored: 0 }
      }

      for (const r of pendingRows ?? []) {
        if (r.contact_id) alreadyPending.add(r.contact_id as string)
      }
    } else {
      for (const r of (rpcRows as { contact_id: string }[] | null) ?? []) {
        if (r.contact_id) alreadyPending.add(r.contact_id)
      }
    }

    // Populate toScore with candidates from this chunk that aren't pending
    for (const d of candidates) {
      const cid = d.contact_id as string
      if (chunk.includes(cid) && !alreadyPending.has(cid) && !seenInToScore.has(cid)) {
        seenInToScore.add(cid)
        toScore.push(d)
        if (toScore.length >= FOLLOWUP_MAX_CANDIDATES_PER_RUN) {
          break
        }
      }
    }

    if (toScore.length >= FOLLOWUP_MAX_CANDIDATES_PER_RUN) {
      break
    }
  }

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

    try {
      const { text, usage } =
        config.provider === 'openai'
          ? await generateOpenAi(providerArgs)
          : config.provider === 'deepseek'
            ? await generateDeepSeek(providerArgs)
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

interface DueScheduledSend {
  id: string
  account_id: string
  contact_id: string
  followup_plan_id: string
  template_name: string
  template_language: string
  template_params: { values?: { body?: string[] } } | null
  followup_plan: { conversation_id: string; status: string } | null
}

/**
 * Dispatches every `scheduled_sends` row whose `send_at` is due — the
 * Follow-up Inteligente plans approved via
 * /api/ai/suggestions/[id]/followup/complete. Reuses the automation
 * engine's `engineSendTemplate` (same account/phone-variant handling,
 * same `messages` insert so the send shows up in the inbox) instead of
 * a hand-rolled Meta API call. Global across accounts, same shape as
 * generateFollowupSuggestions — never throws, a bad row just gets
 * marked `failed` and the run moves on.
 */
export async function processDueFollowupSends(
  db: SupabaseClient,
): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date().toISOString()
  const { data: dueSends, error } = await db
    .from('scheduled_sends')
    .select(
      'id, account_id, contact_id, followup_plan_id, template_name, template_language, template_params, followup_plan:followup_plans(conversation_id, status)',
    )
    .eq('status', 'pending')
    .lte('send_at', now)
    .order('send_at', { ascending: true })
    .limit(FOLLOWUP_MAX_SENDS_PER_RUN)
  if (error) {
    console.error('[followup sends] failed to load due sends:', error)
    return { processed: 0, sent: 0, failed: 0 }
  }
  if (!dueSends || dueSends.length === 0) return { processed: 0, sent: 0, failed: 0 }

  const rows = dueSends as unknown as DueScheduledSend[]

  // whatsapp_config.user_id is the account's config owner — same
  // "arbitrary but stable" stand-in the webhook uses for inserts that
  // need a NOT NULL user_id, since a cron tick has no "current user".
  const ownerByAccount = new Map<string, string | null>()
  async function ownerUserId(accountId: string): Promise<string | null> {
    if (ownerByAccount.has(accountId)) return ownerByAccount.get(accountId) ?? null
    const { data } = await db
      .from('whatsapp_config')
      .select('user_id')
      .eq('account_id', accountId)
      .maybeSingle()
    const id = (data?.user_id as string | undefined) ?? null
    ownerByAccount.set(accountId, id)
    return id
  }

  let sent = 0
  let failed = 0
  const touchedPlans = new Set<string>()

  for (const row of rows) {
    touchedPlans.add(row.followup_plan_id)

    // The plan may have been cancelled (contact replied — see the
    // webhook's cancelActiveFollowupPlan) or completed after this send
    // was queued; cancel-on-reply already flips pending sends to
    // 'cancelled', but this is a defense-in-depth check for the race.
    if (!row.followup_plan || row.followup_plan.status !== 'active') {
      await db.from('scheduled_sends').update({ status: 'cancelled' }).eq('id', row.id)
      continue
    }

    const userId = await ownerUserId(row.account_id)
    if (!userId) {
      await db
        .from('scheduled_sends')
        .update({ status: 'failed', error_message: 'WhatsApp not configured for this account' })
        .eq('id', row.id)
      failed++
      continue
    }

    try {
      const params = row.template_params?.values?.body ?? []
      await engineSendTemplate({
        accountId: row.account_id,
        userId,
        conversationId: row.followup_plan.conversation_id,
        contactId: row.contact_id,
        templateName: row.template_name,
        language: row.template_language,
        params,
      })
      await db
        .from('scheduled_sends')
        .update({ status: 'sent', processed_at: new Date().toISOString() })
        .eq('id', row.id)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[followup sends] send failed for', row.id, message)
      await db.from('scheduled_sends').update({ status: 'failed', error_message: message }).eq('id', row.id)
      failed++
    }
  }

  // Close out plans that have no pending sends left.
  for (const planId of touchedPlans) {
    const { count } = await db
      .from('scheduled_sends')
      .select('id', { count: 'exact', head: true })
      .eq('followup_plan_id', planId)
      .eq('status', 'pending')
    if (!count) {
      await db.from('followup_plans').update({ status: 'completed' }).eq('id', planId).eq('status', 'active')
    }
  }

  return { processed: rows.length, sent, failed }
}
