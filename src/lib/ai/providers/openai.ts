import { AiError, type AiUsage, type ProviderResult } from '../types'
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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

interface OpenAiResponse {
  choices?: {
    message?: OpenAiMessage
    finish_reason?: string
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/** ETER_AGENT_TOOLS' `parameters` field IS OpenAI's
 *  `tools[].function.parameters` verbatim — see schema.ts's header
 *  comment, which documents this as the intended contract. */
function toOpenAiTools(tools: readonly ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
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

/**
 * Run the agentic tool-calling loop against OpenAI's Chat Completions
 * API. Mirrors `runAnthropicToolLoop` (providers/anthropic.ts) — same
 * iteration cap, same per-tool timeout, same "one user turn with every
 * result" batching — adapted to OpenAI's wire shape: tool calls arrive
 * as `message.tool_calls[]` with JSON-string `arguments`, and results
 * go back as individual `role: "tool"` messages (not a single batched
 * turn like Anthropic's `tool_result` blocks).
 */
export async function runOpenAiToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
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

  const openAiTools = toOpenAiTools(tools)
  let conversation: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages).map((m): OpenAiMessage => ({ role: m.role, content: m.content })),
  ]
  let usage: AiUsage | null = null
  let iterations = 0
  let lastText = ''

  while (iterations < maxIterations) {
    iterations += 1

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
          messages: conversation,
          tools: openAiTools,
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
    if (!data) {
      throw new AiError('OpenAI returned an unparseable response.', { code: 'empty_response' })
    }

    usage = sumUsage(
      usage,
      normalizeUsage({
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      }),
    )

    const choice = data.choices?.[0]
    const message = choice?.message
    lastText = (message?.content ?? '').trim()
    const toolCalls = message?.tool_calls ?? []

    if (choice?.finish_reason !== 'tool_calls' || toolCalls.length === 0) {
      return { text: lastText, usage, iterations, hitIterationLimit: false }
    }

    // Echo the assistant's tool_calls turn back verbatim (required so
    // the follow-up `tool` messages have something to pair against),
    // then run every call and append one `role: "tool"` message per
    // result before looping again.
    conversation = [
      ...conversation,
      { role: 'assistant', content: message?.content ?? null, tool_calls: toolCalls },
    ]

    const toolMessages: OpenAiMessage[] = await Promise.all(
      toolCalls.map(async (call): Promise<OpenAiMessage> => {
        let input: Record<string, unknown> = {}
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        } catch (err) {
          logToolEvent('tool_error', {
            toolName: call.function.name,
            toolCallId: call.id,
            detail: `Unparseable tool arguments JSON: ${err instanceof Error ? err.message : String(err)}`,
          })
          return {
            role: 'tool',
            tool_call_id: call.id,
            content: 'Os argumentos enviados para esta ferramenta não eram JSON válido.',
          }
        }

        const result = await executeToolCallWithTimeout(
          { id: call.id, name: call.function.name, input },
          executor,
          toolTimeoutMs,
        )
        return { role: 'tool', tool_call_id: call.id, content: result.content }
      }),
    )

    conversation = [...conversation, ...toolMessages]
  }

  logToolEvent('iteration_limit_reached', {
    iterations,
    detail: `OpenAI tool loop hit maxIterations=${maxIterations} without reaching a natural stop.`,
  })
  return { text: lastText, usage, iterations, hitIterationLimit: true }
}
