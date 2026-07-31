import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  MAX_TOOL_ROUNDS,
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  sumUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string
}

interface AnthropicWireMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): AnthropicWireMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AnthropicWireMessage[],
  timeoutMs: number,
  temperature: number,
  tools: ProviderArgs['tools'],
): Promise<AnthropicResponse> {
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
        temperature,
        messages,
        ...(tools && tools.length > 0
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }
  return ((await res.json().catch(() => null)) as AnthropicResponse | null) ?? {}
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 *
 * When `tools` are configured, runs an internal tool-calling loop
 * (capped at `MAX_TOOL_ROUNDS`): a response containing `tool_use`
 * blocks is answered with a `tool_result` user turn per block, and the
 * model is called again — until it returns a text-only response or the
 * round cap is hit.
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, temperature, tools, executeTool } = args

  const wireMessages = normalizeForAnthropic(messages)
  let usage: ReturnType<typeof normalizeUsage> = null

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callAnthropic(apiKey, model, systemPrompt, wireMessages, timeoutMs, temperature, tools)
    usage = sumUsage(
      usage,
      normalizeUsage({ prompt: data?.usage?.input_tokens, completion: data?.usage?.output_tokens }),
    )

    const blocks = data.content ?? []
    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use')

    if (toolUseBlocks.length > 0 && executeTool) {
      wireMessages.push({ role: 'assistant', content: blocks })
      const toolResults: AnthropicContentBlock[] = []
      for (const block of toolUseBlocks) {
        const result = await executeTool(
          block.name ?? '',
          (block.input as Record<string, unknown>) ?? {},
        )
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }
      wireMessages.push({ role: 'user', content: toolResults })
      continue
    }

    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!text) {
      throw new AiError('Anthropic returned an empty response.', { code: 'empty_response' })
    }
    return { text, usage }
  }

  throw new AiError('Anthropic kept calling tools past the round limit.', {
    code: 'tool_loop_exceeded',
  })
}
