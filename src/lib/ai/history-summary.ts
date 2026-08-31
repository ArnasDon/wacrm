import { MAX_OUTPUT_TOKENS, aiRequestTimeoutMs } from './defaults'
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

/**
 * Cap on a summary call's total output budget. Deliberately the SAME as
 * `MAX_OUTPUT_TOKENS`, not smaller — a common mistake (this file's own
 * first two revisions included) is treating this as "the summary is
 * short, so it needs less budget." On reasoning-capable OpenAI models,
 * internal reasoning tokens are billed against this SAME budget before
 * any visible text comes out, and reasoning-token usage tracks the
 * INPUT's complexity, not the desired output length — a smaller cap
 * doesn't make the model reason less, it just leaves less room left
 * over for the answer once it's done, which is exactly backwards from
 * what you want. `reasoningEffort: 'low'` below (OpenAI/DeepSeek only)
 * is the correct lever for "spend fewer reasoning tokens" — a tighter
 * cap here is not.
 */
const SUMMARY_MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS

/**
 * Recognizes OpenAI/DeepSeek model IDs that are reasoning-capable
 * (o1/o3/o4, gpt-5-and-up, DeepSeek's "reasoner" variant) — the ones
 * that bill internal reasoning against the output-token budget and so
 * actually benefit from `reasoning_effort: 'low'` on a low-complexity
 * task like this. Deliberately conservative: only sent to models this
 * matches, so a plain chat model (gpt-4o-mini, deepseek-chat, ...)
 * never receives a param it might not recognize — model IDs are
 * free-text/user-edited, so guessing wrong in the other direction would
 * risk turning working summarization into a silently-failing 400 for
 * accounts that never had this problem.
 */
function isReasoningModel(model: string): boolean {
  return /^(o[134]\b|gpt-5|gpt-6|deepseek-reasoner)/i.test(model.trim())
}

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
    // Anthropic ignores this field entirely; generateOpenAi (and, via
    // it, DeepSeek) only sends it when set.
    reasoningEffort: isReasoningModel(config.model) ? ('low' as const) : undefined,
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
