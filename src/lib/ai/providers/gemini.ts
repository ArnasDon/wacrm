import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

interface GeminiCandidate {
  content?: {
    parts?: { text?: string }[]
    role?: string
  }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

/**
 * Call Google Gemini via its official native generateContent REST endpoint.
 * Supports gemini-1.5-flash, gemini-2.0-flash, gemini-1.5-pro, etc.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let cleanModel =
    model?.trim().replace(/^models\//, '') || 'gemini-3.5-flash'
  // Auto-upgrade older/throttled models to current gemini-3.5-flash
  if (
    cleanModel === 'gemini-1.5-flash' ||
    cleanModel === 'gemini-1.5-flash-latest' ||
    cleanModel === 'gemini-1.5-pro' ||
    cleanModel === 'gemini-2.0-flash' ||
    cleanModel === 'gemini-2.5-flash' ||
    cleanModel === 'gemini-2.5-pro' ||
    cleanModel === 'gemini-3.8-flash'
  ) {
    cleanModel = 'gemini-3.5-flash'
  }
  const trimmedKey = apiKey.trim()

  // Format messages for Gemini API (user / model roles)
  const contents = mergeConsecutive(messages).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // Gemini requires the first turn in contents to be with role 'user'
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] })
  }
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] })
  }

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  }

  if (systemPrompt && systemPrompt.trim()) {
    payload.system_instruction = {
      parts: [{ text: systemPrompt.trim() }],
    }
  }

  // Model cascade for maximum availability on free tier
  const modelsToTry = [
    cleanModel,
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
  ].filter((m, idx, arr) => arr.indexOf(m) === idx)

  let res: Response | null = null
  let lastError: unknown = null

  for (const targetModel of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(trimmedKey)}`
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': trimmedKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (res.ok) {
        break
      }

      // If hit by 429 (rate limit) or 503 (high demand) or 404, try next fallback model
      if (res.status === 429 || res.status === 503 || res.status === 404) {
        console.warn(
          `[gemini] model ${targetModel} returned ${res.status}, trying fallback model...`,
        )
        continue
      }

      // Other client errors (e.g. 401 invalid key) should stop immediately
      break
    } catch (err) {
      lastError = err
    }
  }

  if (!res) {
    throw toNetworkError(lastError)
  }

  if (!res.ok) {
    throw await providerHttpError('Google Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim()

  if (!text) {
    throw new AiError('Google Gemini returned an empty response.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
  })

  return { text, usage }
}
