import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
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
// ============================================================

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string } }[]
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

/**
 * Call an OpenAI-compatible Chat Completions endpoint with the caller's
 * own key. Returns the raw assistant text + token usage (handoff parsing
 * happens in `generateReply`).
 */
export async function generateChatCompletion(
  args: ProviderArgs,
  endpoint: ChatCompletionsEndpoint,
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

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
    throw await providerHttpError(endpoint.label, res)
  }

  const data = (await res.json().catch(() => null)) as ChatCompletionsResponse | null

  // A 200 carrying an `error` block means the gateway reached us but the
  // upstream model failed — surface its message instead of the generic
  // "empty response" below, which would read as our bug.
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

  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${endpoint.label} returned an empty response.`, {
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
