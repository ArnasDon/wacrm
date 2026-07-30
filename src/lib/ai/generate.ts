import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiMaxProviderAttempts, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateGemini } from './providers/gemini'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/** Error codes worth retrying — transient upstream trouble, not a
 *  problem retrying will fix (a bad key or a safety block never
 *  succeeds on attempt two). */
const RETRYABLE_CODES = new Set(['timeout', 'network_error', 'rate_limited', 'provider_error'])

const RETRY_DELAY_MS = 400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run one provider call, retrying transient failures with linear
 * backoff up to `aiMaxProviderAttempts()` total attempts — the
 * equivalent of n8n's AI Agent node "Retry On Fail / Max Tries".
 */
async function withProviderRetry<T>(call: () => Promise<T>): Promise<T> {
  const maxAttempts = aiMaxProviderAttempts()
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (err) {
      const retryable = err instanceof AiError && RETRYABLE_CODES.has(err.code)
      if (!retryable || attempt >= maxAttempts) throw err
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure
 * (after exhausting retries for transient ones).
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
    temperature: config.temperature,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await withProviderRetry(() => generateOpenAi(providerArgs))
      break
    case 'anthropic':
      result = await withProviderRetry(() => generateAnthropic(providerArgs))
      break
    case 'gemini':
      result = await withProviderRetry(() => generateGemini(providerArgs))
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
