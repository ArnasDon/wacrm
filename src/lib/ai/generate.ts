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
  SET_TEMPERATURE_SENTINEL_PREFIX,
  SET_TEMPERATURE_SENTINEL_SUFFIX,
  SCHEDULE_APPOINTMENT_SENTINEL_PREFIX,
  SCHEDULE_APPOINTMENT_SENTINEL_SUFFIX,
  aiRequestTimeoutMs,
} from './defaults'
import type { LeadTemperature } from '@/types'

const VALID_TEMPERATURES = new Set<LeadTemperature>(['cold', 'warm', 'hot'])
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

  const temperatureMatch = raw.match(
    new RegExp(
      `${escapeRegExp(SET_TEMPERATURE_SENTINEL_PREFIX)}(.+?)${escapeRegExp(SET_TEMPERATURE_SENTINEL_SUFFIX)}`,
    ),
  )
  const temperatureRaw = temperatureMatch ? temperatureMatch[1].trim().toLowerCase() : null
  const leadTemperature = VALID_TEMPERATURES.has(temperatureRaw as LeadTemperature)
    ? (temperatureRaw as LeadTemperature)
    : null

  const appointmentMatch = raw.match(
    new RegExp(
      `${escapeRegExp(SCHEDULE_APPOINTMENT_SENTINEL_PREFIX)}(.+?)${escapeRegExp(SCHEDULE_APPOINTMENT_SENTINEL_SUFFIX)}`,
    ),
  )
  let appointmentProposal: { start: string; end: string; email: string } | null = null
  if (appointmentMatch) {
    const [start, end, email] = appointmentMatch[1].split('|').map((s) => s.trim())
    if (start && end && email) appointmentProposal = { start, end, email }
  }

  const text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .split(MARK_DEAL_WON_SENTINEL)
    .join('')
    .split(SEND_CATALOG_SENTINEL)
    .join('')
    .replace(moveMatch ? moveMatch[0] : '', '')
    .replace(temperatureMatch ? temperatureMatch[0] : '', '')
    .replace(appointmentMatch ? appointmentMatch[0] : '', '')
    .trim()

  return { text, handoff, markDealWon, moveToStageName, sendCatalog, leadTemperature, appointmentProposal, usage }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
