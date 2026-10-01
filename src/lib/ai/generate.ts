import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
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
    case 'gemini':
      result = await generateGemini(providerArgs)
      break
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
 * Normalizes FlyOrder tracking URLs so query params like ?number=, ?id=, ?tracking=
 * are mapped to the canonical ?waybill= format used by flyorder.com.
 */
export function normalizeFlyOrderTrackingUrls(text: string): string {
  if (!text) return ''
  return text.replace(
    /https?:\/\/flyorder\.com\/(ar|en)\/track\?([^\s\)\*\_]+)/gi,
    (match, lang, queryString) => {
      // Isolate any trailing punctuation that was attached to the link
      const matchPunct = queryString.match(/[.,;:!?]+$/)
      const trailingPunct = matchPunct ? matchPunct[0] : ''
      const cleanQuery = queryString.slice(0, queryString.length - trailingPunct.length)

      try {
        const params = new URLSearchParams(cleanQuery)
        const waybill =
          params.get('waybill') ||
          params.get('number') ||
          params.get('id') ||
          params.get('tracking') ||
          params.get('track') ||
          params.get('tracking_number') ||
          params.get('code')

        if (waybill) {
          return `https://flyorder.com/${lang.toLowerCase()}/track?waybill=${encodeURIComponent(waybill)}${trailingPunct}`
        }
      } catch {
        // Fallback to match if parsing fails
      }
      return match
    },
  )
}

/**
 * Format markdown text to WhatsApp-compatible styling.
 * WhatsApp supports *bold*, _italic_, ~strikethrough~, ```code```, and • bullets.
 * Standard markdown uses **bold** and * bullet points, which display as raw asterisks on WhatsApp.
 */
export function formatForWhatsApp(text: string): string {
  if (!text) return ''
  const formatted = text
    // Convert markdown headers (### Header) to bold (*Header*)
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    // Convert markdown bullet points starting with '* ' or '+ ' to '• '
    .replace(/^[\*\+]\s+/gm, '• ')
    // Convert markdown bold '**text**' to WhatsApp bold '*text*'
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    // Clean up multiple asterisks left around words like '***text***' -> '*text*'
    .replace(/\*{3,}([^*]+)\*{3,}/g, '*$1*')

  return normalizeFlyOrderTrackingUrls(formatted)
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
  const stripped = raw.split(HANDOFF_SENTINEL).join('').trim()
  const text = formatForWhatsApp(stripped)
  return { text, handoff, usage }
}
