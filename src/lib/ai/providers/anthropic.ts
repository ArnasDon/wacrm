import { AiError, type AiUsage, type ChatMessage, type ProviderResult } from '../types'
import { aiMaxToolIterations, aiToolTimeoutMs, MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import { executeToolCallWithTimeout } from '../tools/execute'
import { logToolEvent } from '../tools/log'
import type { ToolDefinition } from '../tools/schema'
import { sumUsage, type ToolLoopArgs, type ToolLoopResult } from '../tools/loop-types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicTextBlock {
  type: 'text'
  text: string
}
interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** ETER_AGENT_TOOLS' plain-JSON-Schema `parameters` field is exactly
 *  what Anthropic wants under `input_schema` — see schema.ts's own
 *  header comment, which documents this as the intended contract. */
function toAnthropicTools(tools: readonly ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
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
        messages: normalizeForAnthropic(messages),
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
    ?.filter((b): b is AnthropicTextBlock => b.type === 'text')
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

/**
 * Run the agentic tool-calling loop against Anthropic's Messages API.
 * Each iteration is one request↔response round-trip: if the model's
 * `stop_reason` is `tool_use`, every `tool_use` block in the response is
 * executed (via `args.executor`, timeout-guarded — see
 * `executeToolCallWithTimeout`) and the results appended as a
 * `tool_result` user turn before looping again. Stops on `end_turn` (or
 * any other terminal stop_reason), or after `maxIterations` round-trips
 * — whichever comes first.
 *
 * `pause_turn` (server-side tool budget exhausted) doesn't apply here —
 * ETER_AGENT_TOOLS are all client-executed — but is treated the same as
 * `end_turn` defensively rather than looping forever on an unexpected
 * value.
 */
export async function runAnthropicToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
  const {
    apiKey,
    model,
    systemPrompt,
    messages,
    timeoutMs,
    tools,
    executor,
    maxIterations = aiMaxToolIterations(),
    toolTimeoutMs = aiToolTimeoutMs(),
  } = args

  const anthropicTools = toAnthropicTools(tools)
  let conversation: AnthropicMessage[] = normalizeForAnthropic(messages).map((m) => ({
    role: m.role,
    content: m.content,
  }))
  let usage: AiUsage | null = null
  let iterations = 0
  let lastText = ''

  while (iterations < maxIterations) {
    iterations += 1

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
          tools: anthropicTools,
          messages: conversation,
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
    if (!data) {
      throw new AiError('Anthropic returned an unparseable response.', { code: 'empty_response' })
    }

    usage = sumUsage(usage, normalizeUsage({
      prompt: data.usage?.input_tokens,
      completion: data.usage?.output_tokens,
    }))

    const content = data.content ?? []
    lastText = content
      .filter((b): b is AnthropicTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    const toolUses = content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use')

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { text: lastText, usage, iterations, hitIterationLimit: false }
    }

    // Append the assistant turn (with its tool_use blocks) verbatim,
    // then run every requested tool and append all results as ONE user
    // turn — required by the API (parallel tool calls, single result
    // message) and also what keeps the model from being trained to stop
    // batching calls (see the API skill's tool-use guidance).
    conversation = [...conversation, { role: 'assistant', content }]

    const resultBlocks: AnthropicToolResultBlock[] = await Promise.all(
      toolUses.map(async (call) => {
        const result = await executeToolCallWithTimeout(
          { id: call.id, name: call.name, input: call.input },
          executor,
          toolTimeoutMs,
        )
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.content,
          is_error: result.isError,
        }
      }),
    )

    conversation = [...conversation, { role: 'user', content: resultBlocks }]
  }

  logToolEvent('iteration_limit_reached', {
    iterations,
    detail: `Anthropic tool loop hit maxIterations=${maxIterations} without reaching end_turn.`,
  })
  return { text: lastText, usage, iterations, hitIterationLimit: true }
}
