import { AiError, chatContentText, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  hasImageContent,
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  withoutImageContent,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }
    }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

function dataUrlSource(url: string): { type: 'base64'; media_type: string; data: string } | null {
  const match = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null
  return { type: 'base64', media_type: match[1], data: match[2] }
}

function toAnthropicMessage(message: ChatMessage): AnthropicMessage {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content }
  }

  // Anthropic accepts image blocks on user turns. CRM assistant turns are
  // textual today, but flatten defensively if an old/imported row says else.
  if (message.role === 'assistant') {
    return { role: 'assistant', content: chatContentText(message.content) }
  }

  const blocks: AnthropicContentBlock[] = []
  for (const part of message.content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    const base64 = dataUrlSource(part.url)
    blocks.push({
      type: 'image',
      source: base64 ?? { type: 'url', url: part.url },
    })
  }
  return { role: 'user', content: blocks }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  const normalized = normalizeForAnthropic(messages)
  let providerMessages = normalized.map(toAnthropicMessage)
  const request = (requestMessages: AnthropicMessage[]) =>
    fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: requestMessages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

  let res: Response
  try {
    res = await request(providerMessages)
    if (res.status === 400 && hasImageContent(normalized)) {
      providerMessages = withoutImageContent(normalized).map(toAnthropicMessage)
      res = await request(providerMessages)
    }
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    })
  }
  // Anthropic reports input/output but no total — normalizeUsage sums.
  const usage = normalizeUsage({
    prompt: data?.usage?.input_tokens,
    completion: data?.usage?.output_tokens,
  })
  return { text, usage }
}
