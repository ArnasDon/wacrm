import { AiError, type ProviderResult, type ToolCallLogEntry } from '../types'
import { MAX_OUTPUT_TOKENS, MAX_TOOL_TURNS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

// ============================================================
// The OpenAI Chat Completions wire format.
//
// OpenAI speaks it natively and OpenRouter re-exposes every model in its
// catalogue behind it, so both adapters are the same request with a
// different base URL, label and extra headers.
//
// Tool calling: when `args.tools` is set, this module runs its OWN
// bounded request→tool_calls→execute→re-request loop internally (see
// docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
// "TOOL CALLING") and returns only the final text + aggregated usage +
// a log of what was called — callers (generate.ts) stay wire-format
// agnostic, exactly like the rest of this adapter.
// ============================================================

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  /** OpenRouter reports upstream failures as a 200 with an error body
   *  (the gateway call succeeded; the model behind it did not). */
  error?: { message?: string; code?: number | string }
}

export interface ChatCompletionsEndpoint {
  /** Full URL of the `/chat/completions` endpoint. */
  url: string
  /** Human name used in error messages ("OpenRouter rejected the API key"). */
  label: string
  /** Extra headers merged over `Authorization` + `Content-Type`. */
  headers?: Record<string, string>
}

function toOpenAiTools(tools: NonNullable<ProviderArgs['tools']>) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))
}

/**
 * Call an OpenAI-compatible Chat Completions endpoint with the caller's
 * own key. Returns the raw assistant text + token usage (handoff parsing
 * happens in `generateReply`). Runs a bounded tool-calling loop
 * internally when `args.tools`/`args.executeTool` are set.
 */
export async function generateChatCompletion(
  args: ProviderArgs,
  endpoint: ChatCompletionsEndpoint,
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, executeTool } = args
  const maxTurns = args.maxToolTurns ?? MAX_TOOL_TURNS

  const wireMessages: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages).map((m) => ({ role: m.role, content: m.content }) as OpenAiMessage),
  ]

  const aggregatedUsage = { prompt: 0, completion: 0, total: 0 }
  const toolCallLog: ToolCallLogEntry[] = []
  const wireTools = tools && tools.length > 0 ? toOpenAiTools(tools) : undefined

  for (let turn = 0; ; turn++) {
    let res: Response
    try {
      res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...endpoint.headers,
        },
        body: JSON.stringify({
          model,
          messages: wireMessages,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          ...(wireTools ? { tools: wireTools } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError(endpoint.label, res)
    }

    const data = (await res.json().catch(() => null)) as ChatCompletionsResponse | null

    // A 200 carrying an `error` block means the gateway reached us but
    // the upstream model failed — surface its message instead of the
    // generic "empty response" below, which would read as our bug.
    if (data?.error) {
      const status = Number(data.error.code)
      throw new AiError(
        `${endpoint.label} API error: ${data.error.message ?? 'unknown upstream error'}`,
        {
          code:
            status === 401 || status === 403
              ? 'invalid_key'
              : status === 429
                ? 'rate_limited'
                : 'provider_error',
          status: status === 401 || status === 403 ? 401 : 502,
        },
      )
    }

    if (data?.usage) {
      aggregatedUsage.prompt += data.usage.prompt_tokens ?? 0
      aggregatedUsage.completion += data.usage.completion_tokens ?? 0
      aggregatedUsage.total += data.usage.total_tokens ?? 0
    }

    const message = data?.choices?.[0]?.message
    const requestedCalls = message?.tool_calls ?? []

    if (requestedCalls.length > 0 && executeTool && turn < maxTurns) {
      wireMessages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: requestedCalls })
      for (const call of requestedCalls) {
        let input: unknown = {}
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        } catch {
          input = {}
        }
        const result = await executeTool({ id: call.id, name: call.function.name, input })
        toolCallLog.push({ name: call.function.name, input, result })
        wireMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      }
      continue // ask the model again with the tool results in context
    }

    const text = message?.content
    if (!text || typeof text !== 'string' || !text.trim()) {
      // A model that only ever calls tools and never answers (loop
      // exhausted, or it stopped after a tool call with empty content)
      // must not surface as a hard failure — fall back to a safe,
      // generic line so auto-reply still sends something instead of
      // throwing past the customer.
      if (toolCallLog.length > 0) {
        return {
          text: 'Un momento, permíteme confirmar esa información.',
          usage: normalizeUsage(aggregatedUsage),
          toolCalls: toolCallLog,
        }
      }
      throw new AiError(`${endpoint.label} returned an empty response.`, { code: 'empty_response' })
    }

    return {
      text,
      usage: normalizeUsage(aggregatedUsage),
      toolCalls: toolCallLog,
    }
  }
}
