import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
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

/** One turn in the OpenAI conversation. Ordinary turns are the same
 *  `{role, content}` shape the API accepted before tool calling
 *  existed; `tool_calls`/`tool_call_id` only appear once a tool round
 *  is underway. */
interface OpenAiTurn {
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

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 *
 * When `toolLoop` is present, runs an agentic loop: any `tool_calls` in
 * the response are executed and fed back as `role: 'tool'` messages,
 * repeating until the model returns plain text or `maxIterations` is
 * hit. Without `toolLoop` (the common case today) this makes exactly
 * one request, identical to before tool calling existed.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, toolLoop } = args
  const tools = toolLoop?.toolDefs
  const maxIterations = Math.max(1, toolLoop?.maxIterations ?? 1)

  let turns: OpenAiTurn[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages),
  ]
  let usageTotal: ReturnType<typeof normalizeUsage> = null

  for (let iteration = 0; iteration < maxIterations; iteration++) {
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
          messages: turns,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          ...(tools && tools.length > 0 ? { tools } : {}),
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
    usageTotal = sumUsage(
      usageTotal,
      normalizeUsage({
        prompt: data?.usage?.prompt_tokens,
        completion: data?.usage?.completion_tokens,
        total: data?.usage?.total_tokens,
      }),
    )

    const message = data?.choices?.[0]?.message
    const toolCalls = message?.tool_calls ?? []

    if (toolCalls.length === 0 || !toolLoop) {
      const text = message?.content
      if (!text || typeof text !== 'string' || !text.trim()) {
        throw new AiError('OpenAI returned an empty response.', {
          code: 'empty_response',
        })
      }
      return { text, usage: usageTotal }
    }

    turns = [...turns, { role: 'assistant', content: message?.content ?? null, tool_calls: toolCalls }]

    for (const call of toolCalls) {
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs = JSON.parse(call.function.arguments || '{}')
      } catch {
        // Malformed JSON from the model — leave args empty; executeTool's
        // required-param check will turn that into a clear error the
        // model sees in the tool result and can correct.
      }
      const result = await toolLoop.runTool(call.function.name, toolArgs)
      toolLoop.onToolCall({ toolName: call.function.name, args: toolArgs, result })
      turns.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.ok ? result.body ?? '(empty response)' : `Error: ${result.error}`,
      })
    }

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
