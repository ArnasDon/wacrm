import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
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
  type: string
  text?: string
  /** tool_use */
  id?: string
  name?: string
  input?: Record<string, unknown>
  /** tool_result */
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** One turn in the Anthropic conversation. `content` is a plain string
 *  for ordinary turns (identical to what the API accepted before tool
 *  calling existed) and a content-block array only once a tool round
 *  is underway — that distinction is what keeps the very first request
 *  of every call unchanged. */
interface AnthropicTurn {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): AnthropicTurn[] {
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
 *
 * When `toolLoop` is present, runs an agentic loop: any `tool_use`
 * blocks in the response are executed and fed back as `tool_result`
 * blocks, repeating until the model returns plain text or
 * `maxIterations` is hit. Without `toolLoop` (the common case today)
 * this makes exactly one request, identical to before tool calling
 * existed.
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, toolLoop } = args
  const tools = toolLoop?.toolDefs
  const maxIterations = Math.max(1, toolLoop?.maxIterations ?? 1)

  let turns: AnthropicTurn[] = normalizeForAnthropic(messages)
  let usageTotal: ReturnType<typeof normalizeUsage> = null

  for (let iteration = 0; iteration < maxIterations; iteration++) {
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
          messages: turns,
          ...(tools && tools.length > 0 ? { tools } : {}),
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
    usageTotal = sumUsage(
      usageTotal,
      normalizeUsage({
        prompt: data?.usage?.input_tokens,
        completion: data?.usage?.output_tokens,
      }),
    )

    const blocks = data?.content ?? []
    const toolUses = blocks.filter(
      (b): b is AnthropicContentBlock & { id: string; name: string } =>
        b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string',
    )

    if (toolUses.length === 0 || !toolLoop) {
      const text = blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
        .trim()
      if (!text) {
        throw new AiError('Anthropic returned an empty response.', {
          code: 'empty_response',
        })
      }
      return { text, usage: usageTotal }
    }

    turns = [...turns, { role: 'assistant', content: blocks }]

    const resultBlocks: AnthropicContentBlock[] = []
    for (const block of toolUses) {
      const toolArgs = (block.input ?? {}) as Record<string, unknown>
      const result = await toolLoop.runTool(block.name, toolArgs)
      toolLoop.onToolCall({ toolName: block.name, args: toolArgs, result })
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.ok ? result.body ?? '(empty response)' : `Error: ${result.error}`,
        is_error: !result.ok,
      })
    }
    turns = [...turns, { role: 'user', content: resultBlocks }]

    // The round just completed always finishes — this only gates
    // starting another one, so it can't cut off a call already in
    // flight, only prevent a further one after the budget is spent.
    if (Date.now() > toolLoop.deadlineAt) {
      throw new AiError('The agent ran out of time using tools to finish a reply.', {
        code: 'tool_loop_timeout',
      })
    }
  }

  throw new AiError('The agent used tools too many times without finishing a reply.', {
    code: 'tool_loop_exhausted',
  })
}
