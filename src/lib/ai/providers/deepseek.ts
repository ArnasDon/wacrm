import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

interface DeepSeekResponse {
  choices?: {
    message?: {
      content?: string | null
      reasoning_content?: string | null
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
  }
}

/**
 * Call DeepSeek's OpenAI-compatible Chat Completions endpoint with the caller's key.
 * Commercial model: DeepSeek-V4.1-Flash-1017
 * Official API model identifier: 'deepseek-flash'
 * Endpoint: https://api.deepseek.com/chat/completions
 *
 * Supports structured outputs (response_format: { type: 'json_object' }) and reasoning modes
 * (extracting content with reasoning_content fallback).
 * Parses prompt caching statistics (prompt_cache_hit_tokens) and token usage.
 */
export async function generateDeepSeek(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, structuredOutputRequired, maxOutputTokens } = args

  if (!apiKey || !apiKey.trim()) {
    throw new AiError('DeepSeek API key is required.', {
      code: 'missing_key',
      status: 400,
    })
  }

  let res: Response
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'deepseek-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_tokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        ...(structuredOutputRequired ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('DeepSeek', res)
  }

  const data = (await res.json().catch(() => null)) as DeepSeekResponse | null
  const choice = data?.choices?.[0]?.message
  const text = choice?.content || choice?.reasoning_content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('DeepSeek returned an empty response.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
    cached: data?.usage?.prompt_cache_hit_tokens,
  })

  return { text, usage }
}
