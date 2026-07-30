import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  promptFeedback?: { blockReason?: string }
}

/**
 * Gemini's `contents` array uses `user`/`model` roles (not `assistant`)
 * and, like Anthropic, expects turns to alternate starting on `user` —
 * the system prompt is a separate top-level field, not a turn.
 */
function toGeminiContents(messages: ChatMessage[]) {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  const turns =
    merged.length > 0
      ? merged
      : [{ role: 'user' as const, content: '(The customer has not sent a message yet.)' }]
  return turns.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

/**
 * Gemini reports an invalid key as HTTP 400 (`status: "INVALID_ARGUMENT"`
 * or `"UNAUTHENTICATED"`/`"PERMISSION_DENIED"`), not 401/403 like OpenAI
 * and Anthropic — the shared `providerHttpError` status-code mapping
 * would otherwise bucket it as a generic provider error, so it gets its
 * own mapper.
 */
async function geminiHttpError(res: Response): Promise<AiError> {
  let message = ''
  let apiStatus = ''
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } }
    message = body?.error?.message ?? ''
    apiStatus = body?.error?.status ?? ''
  } catch {
    // Non-JSON error body — fall back to the HTTP status line.
  }

  const invalidKey =
    res.status === 401 ||
    res.status === 403 ||
    apiStatus === 'UNAUTHENTICATED' ||
    apiStatus === 'PERMISSION_DENIED' ||
    /api key not valid|api_key_invalid/i.test(message)

  const code = invalidKey ? 'invalid_key' : res.status === 429 ? 'rate_limited' : 'provider_error'
  const base =
    code === 'invalid_key'
      ? 'Gemini rejected the API key'
      : code === 'rate_limited'
        ? 'Gemini rate limit reached'
        : `Gemini API error (${res.status})`

  return new AiError(message ? `${base}: ${message}` : base, {
    code,
    status: code === 'invalid_key' ? 401 : 502,
  })
}

/**
 * Call Google's Gemini `generateContent` endpoint with the caller's own
 * key. Returns the raw assistant text + token usage (handoff parsing
 * happens in `generateReply`).
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, temperature } = args

  let res: Response
  try {
    res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: toGeminiContents(messages),
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await geminiHttpError(res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim()
  if (!text) {
    // A prompt/response can be blocked by Gemini's safety filters with no
    // candidates at all — surface that distinctly from a bare empty reply.
    const blockReason = data?.promptFeedback?.blockReason
    throw new AiError(
      blockReason
        ? `Gemini blocked the request (${blockReason}).`
        : 'Gemini returned an empty response.',
      { code: 'empty_response' },
    )
  }
  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
  })
  return { text, usage }
}
