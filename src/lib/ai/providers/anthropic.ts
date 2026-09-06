import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin AND end with `user` — it rejects a transcript ending on
 * `assistant` outright ("This model does not support assistant message
 * prefill. The conversation must end with a user message"), not with a
 * retryable/transient error. `buildConversationContext` (context.ts)
 * just returns the account's most recent messages in order, so its
 * last entry is whoever sent the newest one — normally the customer,
 * but a race between two overlapping auto-reply dispatches for the
 * same rapid-fire burst can read the context *after* an earlier
 * dispatch already inserted its own reply, landing here with a
 * trailing assistant turn (confirmed live 2026-09-03/04 — see
 * `ai_generate_error` alerts). Merge consecutive turns, then drop any
 * leading OR trailing assistant turns (a greeting before the customer
 * spoke; an answer already given) so the transcript always starts and
 * ends on the customer. Guarantees a valid payload — never guarantees
 * a non-empty one, callers must still handle `[]`.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  while (merged.length > 0 && merged[merged.length - 1].role === 'assistant') {
    merged.pop()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * Wire shape for the Messages API. A plain turn stays `content: string`
 * (unchanged — keeps every existing transcript byte-identical); a turn
 * that carries customer photos becomes a text block followed by one
 * `image` block per photo.
 */
function toAnthropicMessages(
  messages: ChatMessage[],
): { role: 'user' | 'assistant'; content: string | AnthropicBlock[] }[] {
  return messages.map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.content }
    const blocks: AnthropicBlock[] = [{ type: 'text', text: m.content }]
    for (const img of m.images) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.dataBase64 },
      })
    }
    return { role: m.role, content: blocks }
  })
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
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
        messages: toAnthropicMessages(normalizeForAnthropic(messages)),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
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
