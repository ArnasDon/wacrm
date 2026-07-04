import { AiError, type ChatMessage } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { ADD_TAG_TOOL_NAME, type ToolDef } from '../tag-tool'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderToolCall,
  type ProviderToolResult,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
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
 * Returns the raw assistant text (handoff parsing happens in
 * `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<string> {
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
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    })
  }
  return text
}

function toAnthropicToolPayload(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: {
        tag_id: { type: 'string', enum: tool.tagIds },
        reason: {
          type: 'string',
          description: 'A short sentence explaining why this tag applies to this conversation.',
        },
      },
      required: ['tag_id', 'reason'],
    },
  }
}

/** Parse `add_tag` tool_use blocks out of a raw Anthropic content array.
 *  A missing `tag_id` silently drops that one block rather than failing
 *  the whole response. */
function parseAnthropicToolCalls(content: AnthropicContentBlock[] | undefined): ProviderToolCall[] {
  const out: ProviderToolCall[] = []
  for (const block of content ?? []) {
    if (block.type !== 'tool_use' || block.name !== ADD_TAG_TOOL_NAME || !block.id) continue
    const input = block.input as { tag_id?: string; reason?: string } | undefined
    if (!input?.tag_id) continue
    out.push({ id: block.id, tagId: input.tag_id, reason: input.reason ?? '' })
  }
  return out
}

export interface AnthropicTurnResult {
  text: string | null
  toolCalls: ProviderToolCall[]
  assistantContent: AnthropicContentBlock[]
}

/**
 * First turn of a tool-enabled call: sends the `add_tag` tool and
 * returns whatever the model did, without throwing on empty text — a
 * tool-only response has no `text` block at all.
 */
export async function generateAnthropicTurn(
  args: ProviderArgs & { tool: ToolDef },
): Promise<AnthropicTurnResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tool } = args

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
        tools: [toAnthropicToolPayload(tool)],
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
  const content = data?.content ?? []
  const toolCalls = parseAnthropicToolCalls(content)
  const text =
    content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim() || null

  if (toolCalls.length === 0 && !text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    })
  }

  return { text, toolCalls, assistantContent: content }
}

/**
 * Second (and final) turn after tag-apply side effects have run: replay
 * the assistant's tool_use content plus one bundled `user` turn with a
 * `tool_result` block per call, and get the natural-language reply.
 * Anthropic (unlike OpenAI) allows multiple `tool_result` blocks in a
 * single user turn.
 */
export async function continueAnthropicAfterTools(
  args: ProviderArgs & {
    assistantContent: AnthropicContentBlock[]
    toolResults: ProviderToolResult[]
  },
): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, assistantContent, toolResults } = args

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
        messages: [
          ...normalizeForAnthropic(messages),
          { role: 'assistant', content: assistantContent },
          {
            role: 'user',
            content: toolResults.map((tr) => ({
              type: 'tool_result',
              tool_use_id: tr.id,
              content: tr.content,
            })),
          },
        ],
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
  return text
}
