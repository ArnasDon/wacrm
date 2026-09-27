import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, '')
  if (!value) throw new AiError('OpenAI-compatible API base URL is required.', { code: 'invalid_base_url', status: 400 })
  let parsed: URL
  try { parsed = new URL(value) } catch {
    throw new AiError('OpenAI-compatible API base URL must be a valid URL.', { code: 'invalid_base_url', status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiError('OpenAI-compatible API base URL must use http:// or https://.', { code: 'invalid_base_url', status: 400 })
  }
  if (parsed.username || parsed.password) {
    throw new AiError('OpenAI-compatible API base URL must not contain embedded credentials.', { code: 'invalid_base_url', status: 400 })
  }
  if (parsed.search || parsed.hash) {
    throw new AiError('OpenAI-compatible API base URL must not contain a query string or fragment.', { code: 'invalid_base_url', status: 400 })
  }
  const normalized = parsed.toString().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

interface OpenAiCompatibleResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export async function generateOpenAiCompatible(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, baseUrl } = args
  const endpoint = normalizeOpenAiCompatibleBaseUrl(baseUrl ?? '')
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...mergeConsecutive(messages)],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) { throw toNetworkError(err) }
  if (!res.ok) throw await providerHttpError('OpenAI-compatible provider', res)
  const data = (await res.json().catch(() => null)) as OpenAiCompatibleResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI-compatible provider returned an empty response.', { code: 'empty_response' })
  }
  return {
    text,
    usage: normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    }),
  }
}