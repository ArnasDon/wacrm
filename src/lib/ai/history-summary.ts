import { aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import type { AiConfig, AiUsage, ChatMessage } from './types'

// ============================================================
// Condenses conversation history older than the current context
// window into a short running summary, so a long-running conversation
// doesn't just lose its earlier context once it exceeds the window —
// see `buildContextWithHistorySummary` in context.ts, which owns the
// incremental "only summarize the new delta" bookkeeping and persists
// the result. This module is a plain LLM-calling utility: it knows
// nothing about the DB, the conversation, or persistence.
// ============================================================

/** Cap on a summary's own length — this is condensed context for the
 *  model, not a reply; keeps the summarization call itself cheap and
 *  keeps the resulting summary from growing unbounded turn after turn. */
const SUMMARY_MAX_OUTPUT_TOKENS = 300

export interface SummarizeResult {
  summary: string
  usage: AiUsage | null
}

/**
 * Condense `newMessages` (the messages that just aged out of the
 * context window) into an updated summary, folding in `priorSummary`
 * when there is one. Calls the account's configured provider adapter
 * DIRECTLY (`generateOpenAi`/`generateAnthropic`) — not `generateReply`
 * — since a summarization call needs neither the tool loop nor handoff-
 * sentinel parsing; it's a plain completion.
 *
 * Never throws: any failure (network, provider, empty response) returns
 * `null` so the caller falls back to the last known-good summary (or
 * plain truncation if there isn't one) rather than losing the reply.
 */
export async function summarizeOlderMessages(args: {
  config: Pick<AiConfig, 'provider' | 'model' | 'apiKey'>
  priorSummary: string | null
  newMessages: ChatMessage[]
}): Promise<SummarizeResult | null> {
  const { config, priorSummary, newMessages } = args
  if (newMessages.length === 0) return null

  const systemPrompt = [
    'Condense this excerpt of a customer-support WhatsApp conversation into a short, factual summary for another assistant to use as context on the next reply.',
    'Preserve: names, order or reference numbers, specific requests, decisions made, and anything promised. Omit small talk and pleasantries.',
    'Write plain prose, third person, at most a few sentences — a condensed summary, not a transcript and not a list of every message.',
    priorSummary
      ? `Existing summary of even earlier messages — fold this in, don't just repeat it:\n${priorSummary}`
      : '',
  ]
    .filter((p) => p.trim())
    .join('\n\n')

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages: newMessages,
    timeoutMs: aiRequestTimeoutMs(),
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
  }

  try {
    const result =
      config.provider === 'anthropic'
        ? await generateAnthropic(providerArgs)
        : config.provider === 'deepseek'
          ? await generateDeepSeek(providerArgs)
          : await generateOpenAi(providerArgs)
    const summary = result.text.trim()
    if (!summary) return null
    return { summary, usage: result.usage }
  } catch (err) {
    console.error('[ai history-summary] summarization failed:', err)
    return null
  }
}
