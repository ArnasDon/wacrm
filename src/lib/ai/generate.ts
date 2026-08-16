import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL,
  MARK_DEAL_WON_SENTINEL,
  MOVE_DEAL_SENTINEL_PREFIX,
  MOVE_DEAL_SENTINEL_SUFFIX,
  SEND_CATALOG_SENTINEL,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
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
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
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
 * Split the raw model output into
 * `{ text, handoff, markDealWon, moveToStageName, usage }`. Any sentinel
 * can appear alone or trailing a partial reply; either way we strip the
 * marker(s) from the text sent to the customer. `usage` is passed
 * straight through (null when the provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const markDealWon = raw.includes(MARK_DEAL_WON_SENTINEL)
  const sendCatalog = raw.includes(SEND_CATALOG_SENTINEL)

  const moveMatch = raw.match(
    new RegExp(
      `${escapeRegExp(MOVE_DEAL_SENTINEL_PREFIX)}(.+?)${escapeRegExp(MOVE_DEAL_SENTINEL_SUFFIX)}`,
    ),
  )
  const moveToStageName = moveMatch ? moveMatch[1].trim() : null

  const text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .split(MARK_DEAL_WON_SENTINEL)
    .join('')
    .split(SEND_CATALOG_SENTINEL)
    .join('')
    .replace(moveMatch ? moveMatch[0] : '', '')
    .trim()

  return { text, handoff, markDealWon, moveToStageName, sendCatalog, usage }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
