import { AiError, type ProviderResult } from '../types'
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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

interface OpenAiResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

async function callOpenAi(
  apiKey: string,
  model: string,
  messages: OpenAiWireMessage[],
  timeoutMs: number,
  temperature: number,
  tools: ProviderArgs['tools'],
): Promise<OpenAiResponse> {
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
        messages,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        temperature,
        ...(tools && tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
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
    throw await providerHttpError('OpenAI', res)
  }
  return ((await res.json().catch(() => null)) as OpenAiResponse | null) ?? {}
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 *
 * When `tools` are configured, runs an internal tool-calling loop
 * (capped at `MAX_TOOL_ROUNDS`): if the model responds with
 * `tool_calls` instead of final text, each is executed via
 * `executeTool`, the results are appended as `role: 'tool'` messages,
 * and the model is called again — until it returns plain text or the
 * round cap is hit.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, temperature, tools, executeTool } = args

  const wireMessages: OpenAiWireMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages).map((m) => ({ role: m.role, content: m.content })),
  ]

  let usage: ReturnType<typeof normalizeUsage> = null

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callOpenAi(apiKey, model, wireMessages, timeoutMs, temperature, tools)
    usage = sumUsage(
      usage,
      normalizeUsage({
        prompt: data?.usage?.prompt_tokens,
        completion: data?.usage?.completion_tokens,
        total: data?.usage?.total_tokens,
      }),
    )

    const message = data?.choices?.[0]?.message
    const toolCalls = message?.tool_calls

    if (toolCalls && toolCalls.length > 0 && executeTool) {
      wireMessages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: toolCalls })
      for (const call of toolCalls) {
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(call.function.arguments || '{}')
        } catch {
          // Malformed arguments from the model — run with an empty object
          // rather than failing the whole turn.
        }
        const result = await executeTool(call.function.name, parsedArgs)
        wireMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
      continue // ask the model to continue with the tool results
    }

    const text = message?.content
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new AiError('OpenAI returned an empty response.', { code: 'empty_response' })
    }
    return { text, usage }
  }

  throw new AiError('OpenAI kept calling tools past the round limit.', {
    code: 'tool_loop_exceeded',
  })
}
