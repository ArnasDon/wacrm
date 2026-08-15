import { AiError, type AiUsage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { ADD_TAG_TOOL_NAME, type ToolDef } from '../tag-tool'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderToolCall,
  type ProviderToolResult,
} from './shared'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiResponse {
  choices?: { message?: OpenAiResponseMessage }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

interface OpenAiResponseMessage {
  content?: string | null
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

/** The assistant message exactly as OpenAI returned it — must be
 *  replayed verbatim in the tool-result follow-up request. */
export interface OpenAiAssistantMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: OpenAiResponseMessage['tool_calls']
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI returned an empty response.', {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}

function toOpenAiToolPayload(tool: ToolDef) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
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
    },
  }
}

/** Parse the `add_tag` tool calls out of a raw OpenAI response message.
 *  Malformed arguments or a missing `tag_id` silently drop that one
 *  call rather than failing the whole response. */
function parseOpenAiToolCalls(message: OpenAiResponseMessage | undefined): ProviderToolCall[] {
  const calls = message?.tool_calls ?? []
  const out: ProviderToolCall[] = []
  for (const call of calls) {
    if (call.function?.name !== ADD_TAG_TOOL_NAME) continue
    try {
      const parsed = JSON.parse(call.function.arguments) as { tag_id?: string; reason?: string }
      if (!parsed.tag_id) continue
      out.push({ id: call.id, tagId: parsed.tag_id, reason: parsed.reason ?? '' })
    } catch {
      // Malformed JSON from the model — skip this call, don't crash the reply.
    }
  }
  return out
}

export interface OpenAiTurnResult {
  text: string | null
  toolCalls: ProviderToolCall[]
  assistantMessage: OpenAiAssistantMessage
  usage: AiUsage | null
}

/**
 * First turn of a tool-enabled call: sends the `add_tag` tool and
 * returns whatever the model did, without throwing on empty text —
 * OpenAI commonly returns `content: null` when it only calls a tool.
 */
export async function generateOpenAiTurn(
  args: ProviderArgs & { tool: ToolDef },
): Promise<OpenAiTurnResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tool } = args

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        tools: [toOpenAiToolPayload(tool)],
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const message = data?.choices?.[0]?.message
  const toolCalls = parseOpenAiToolCalls(message)
  const text = typeof message?.content === 'string' ? message.content : null

  if (toolCalls.length === 0 && (!text || !text.trim())) {
    throw new AiError('OpenAI returned an empty response.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return {
    text,
    toolCalls,
    assistantMessage: {
      role: 'assistant',
      content: message?.content ?? null,
      tool_calls: message?.tool_calls,
    },
    usage,
  }
}

/**
 * Second (and final) turn after tag-apply side effects have run: replay
 * the assistant's tool-call message plus one `tool` result message per
 * call — OpenAI 400s if any `tool_call_id` from the first turn is left
 * without a matching result — and get the natural-language reply.
 */
export interface OpenAiContinueResult {
  text: string
  usage: AiUsage | null
}

export async function continueOpenAiAfterTools(
  args: ProviderArgs & {
    assistantMessage: OpenAiAssistantMessage
    toolResults: ProviderToolResult[]
  },
): Promise<OpenAiContinueResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, assistantMessage, toolResults } = args

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
          assistantMessage,
          ...toolResults.map((tr) => ({
            role: 'tool' as const,
            tool_call_id: tr.id,
            content: tr.content,
          })),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI returned an empty response.', {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
