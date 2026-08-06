import { AiError, type AiUsage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_TOOL_ROUNDS = 4

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAiToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenAiToolCall[]
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function addUsage(total: AiUsage | null, next: AiUsage | null): AiUsage | null {
  if (!total) return next
  if (!next) return total
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  }
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * When server-controlled tools are supplied, tool calls are executed in a
 * bounded loop and their results are returned to the model before the final
 * customer-facing answer is accepted.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const {
    apiKey,
    model,
    systemPrompt,
    messages,
    timeoutMs,
    tools = [],
    executeTool,
  } = args

  if (tools.length > 0 && !executeTool) {
    throw new AiError('AI tools were configured without a server executor.', {
      code: 'invalid_tool_configuration',
      status: 500,
    })
  }

  const transcript: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ]
  let accumulatedUsage: AiUsage | null = null

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
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
          messages: transcript,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
                tool_choice: 'auto',
              }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) throw await providerHttpError('OpenAI', res)

    const data = (await res.json().catch(() => null)) as OpenAiResponse | null
    accumulatedUsage = addUsage(
      accumulatedUsage,
      normalizeUsage({
        prompt: data?.usage?.prompt_tokens,
        completion: data?.usage?.completion_tokens,
        total: data?.usage?.total_tokens,
      }),
    )

    const message = data?.choices?.[0]?.message
    if (!message) {
      throw new AiError('OpenAI returned an empty response.', {
        code: 'empty_response',
      })
    }

    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length === 0) {
      const text = message.content
      if (!text || typeof text !== 'string' || !text.trim()) {
        throw new AiError('OpenAI returned an empty response.', {
          code: 'empty_response',
        })
      }
      return { text, usage: accumulatedUsage }
    }

    if (round === MAX_TOOL_ROUNDS) {
      throw new AiError('The AI exceeded the maximum number of tool steps.', {
        code: 'tool_round_limit',
      })
    }

    transcript.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      let result: string
      try {
        result = await executeTool!({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        result = JSON.stringify({ ok: false, error: detail })
      }
      transcript.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  throw new AiError('The AI tool loop ended unexpectedly.', {
    code: 'tool_loop_failed',
  })
}
