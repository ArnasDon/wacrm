import { AiError, type ChatMessage, type ProviderResult, type ToolCallLogEntry } from '../types'
import { MAX_OUTPUT_TOKENS, MAX_TOOL_TURNS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): AnthropicMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged.map((m) => ({ role: m.role, content: m.content }))
}

function toAnthropicTools(tools: NonNullable<ProviderArgs['tools']>) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`). Runs a bounded tool-calling loop internally when
 * `args.tools`/`args.executeTool` are set — see
 * docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
 * ("TOOL CALLING").
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, executeTool } = args
  const maxTurns = args.maxToolTurns ?? MAX_TOOL_TURNS

  const wireMessages = normalizeForAnthropic(messages)
  const aggregatedUsage = { prompt: 0, completion: 0 }
  const toolCallLog: ToolCallLogEntry[] = []
  const wireTools = tools && tools.length > 0 ? toAnthropicTools(tools) : undefined

  for (let turn = 0; ; turn++) {
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
          messages: wireMessages,
          ...(wireTools ? { tools: wireTools } : {}),
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
    const blocks = data?.content ?? []

    aggregatedUsage.prompt += data?.usage?.input_tokens ?? 0
    aggregatedUsage.completion += data?.usage?.output_tokens ?? 0

    const toolUseBlocks = blocks.filter((b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')

    if (toolUseBlocks.length > 0 && executeTool && turn < maxTurns) {
      wireMessages.push({ role: 'assistant', content: blocks })
      const resultBlocks: AnthropicContentBlock[] = []
      for (const block of toolUseBlocks) {
        const result = await executeTool({ id: block.id, name: block.name, input: block.input })
        toolCallLog.push({ name: block.name, input: block.input, result })
        resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }
      wireMessages.push({ role: 'user', content: resultBlocks })
      continue // ask the model again with the tool results in context
    }

    const text = blocks
      .filter((b): b is Extract<AnthropicContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!text) {
      if (toolCallLog.length > 0) {
        return {
          text: 'Un momento, permíteme confirmar esa información.',
          usage: normalizeUsage({ prompt: aggregatedUsage.prompt, completion: aggregatedUsage.completion }),
          toolCalls: toolCallLog,
        }
      }
      throw new AiError('Anthropic returned an empty response.', { code: 'empty_response' })
    }

    // Anthropic reports input/output but no total — normalizeUsage sums.
    return {
      text,
      usage: normalizeUsage({ prompt: aggregatedUsage.prompt, completion: aggregatedUsage.completion }),
      toolCalls: toolCallLog,
    }
  }
}
