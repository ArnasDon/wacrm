import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig, ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { summarizeOlderMessages } from './history-summary'
import { logAiUsage } from './usage'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

function toChatMessage(m: DbMessage): ChatMessage {
  return {
    role: m.sender_type === 'customer' ? 'user' : 'assistant',
    content: m.content_text!.trim(),
  }
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
    }))
}

export interface ContextWithHistory {
  messages: ChatMessage[]
  /** Condensed summary of everything older than the context window.
   *  Undefined when the conversation hasn't exceeded the window, the
   *  account hasn't enabled `summarizeHistory`, or summarization has
   *  never succeeded for this thread. */
  historySummary?: string
}

/**
 * `buildConversationContext`, plus opt-in incremental summarization of
 * whatever falls outside the window instead of silently dropping it.
 *
 * Cost-aware by construction: the common case (a conversation that
 * hasn't exceeded `config.contextMessageLimit`, or an account that
 * hasn't enabled `summarizeHistory`) takes the exact same single query
 * as `buildConversationContext` and returns immediately — no count
 * query, no summarization call, no behaviour change. Only once a
 * conversation genuinely exceeds the window does this do more work, and
 * even then it only ever summarizes the messages that have newly aged
 * out since the last turn (tracked via
 * `conversations.ai_history_summary_covers_count`), never the whole
 * history again — so a long-running conversation's summarization cost
 * stays flat, not proportional to how long it's grown.
 *
 * Every extra step is best-effort: a failed count, a failed fetch, a
 * failed summarization call, or a failed persist all fall back to
 * reusing whatever summary was already there (or none) and still
 * return the last `limit` raw messages — this never blocks or breaks
 * the reply that's waiting on it.
 */
export async function buildContextWithHistorySummary(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  config: Pick<
    AiConfig,
    'provider' | 'model' | 'apiKey' | 'contextMessageLimit' | 'summarizeHistory'
  >,
): Promise<ContextWithHistory> {
  const limit = config.contextMessageLimit

  if (!config.summarizeHistory) {
    return { messages: await buildConversationContext(db, conversationId, limit) }
  }

  let count: number | null = null
  try {
    const res = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('content_type', 'text')
    count = res.count
  } catch (err) {
    console.error('[ai history-summary] count query failed:', err)
  }

  if (!count || count <= limit) {
    return { messages: await buildConversationContext(db, conversationId, limit) }
  }

  const olderCount = count - limit
  let summary: string | null = null
  let coversCount = 0
  try {
    const { data: conv } = await db
      .from('conversations')
      .select('ai_history_summary, ai_history_summary_covers_count')
      .eq('id', conversationId)
      .maybeSingle()
    summary = conv?.ai_history_summary ?? null
    coversCount = conv?.ai_history_summary_covers_count ?? 0
  } catch (err) {
    console.error('[ai history-summary] reading stored summary failed:', err)
  }

  if (coversCount < olderCount) {
    try {
      // Only the NEW delta — messages between what's already summarized
      // and the new older-boundary. `.range` is inclusive on both ends.
      const { data: deltaRows, error: deltaErr } = await db
        .from('messages')
        .select('sender_type, content_text')
        .eq('conversation_id', conversationId)
        .eq('content_type', 'text')
        .order('created_at', { ascending: true })
        .range(coversCount, olderCount - 1)

      if (!deltaErr && deltaRows && deltaRows.length > 0) {
        const deltaMessages = (deltaRows as DbMessage[])
          .filter((m) => m.content_text && m.content_text.trim())
          .map(toChatMessage)

        const result = await summarizeOlderMessages({
          config,
          priorSummary: summary,
          newMessages: deltaMessages,
        })

        if (result) {
          summary = result.summary
          coversCount = olderCount
          const { error: updErr } = await db
            .from('conversations')
            .update({
              ai_history_summary: summary,
              ai_history_summary_covers_count: coversCount,
            })
            .eq('id', conversationId)
          // Not fatal — a failed persist just means the next turn redoes
          // this same delta, not that the reply is lost.
          if (updErr) {
            console.error('[ai history-summary] persisting summary failed:', updErr)
          }
          void logAiUsage(db, {
            accountId,
            conversationId,
            mode: 'history_summary',
            provider: config.provider,
            model: config.model,
            usage: result.usage,
          })
        }
      }
    } catch (err) {
      console.error('[ai history-summary] delta summarization failed:', err)
    }
  }

  const messages = await buildConversationContext(db, conversationId, limit)
  return { messages, historySummary: summary ?? undefined }
}
