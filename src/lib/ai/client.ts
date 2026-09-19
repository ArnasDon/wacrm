import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { decrypt } from '@/lib/security/secrets'
import { safeFetch } from '@/lib/security/safe-fetch'
import type { AIProviderDoc } from '@/lib/db/types'
import { getPreset } from './presets'

// ============================================================
// One entry point — `generateJSON()` — over every provider kind.
// The sales rep asks for a JSON object matching a schema; each
// adapter uses the provider's native structured/JSON mode and we
// still parse defensively (open models don't always comply).
//
// Outbound calls to user-configurable base URLs go through
// safeFetch (SSRF guard). Private/localhost endpoints (Ollama,
// LM Studio) are only reachable when ALLOW_PRIVATE_AI_ENDPOINTS=true
// — meant for single-tenant self-hosted installs, never a shared
// multi-tenant deployment.
// ============================================================

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateJSONInput {
  system: string
  messages: ChatTurn[]
  /** JSON schema of the object we want back. */
  schema: Record<string, unknown>
  maxTokens?: number
}

export class AIProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIProviderError'
  }
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_AI_ENDPOINTS === 'true'

function apiKeyOf(provider: AIProviderDoc): string | null {
  return provider.apiKeyEnc ? decrypt(provider.apiKeyEnc) : null
}

export async function generateJSON(
  provider: AIProviderDoc,
  input: GenerateJSONInput,
): Promise<unknown> {
  const text =
    provider.kind === 'anthropic'
      ? await anthropicGenerate(provider, input)
      : provider.kind === 'gemini'
        ? await geminiGenerate(provider, input)
        : await openAICompatibleGenerate(provider, input)
  return parseJsonLoose(text)
}

/** Extract the first JSON object from model output. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    throw new AIProviderError('Model did not return valid JSON')
  }
}

// ------------------------------------------------------------
// Anthropic (official SDK)
// ------------------------------------------------------------

async function anthropicGenerate(provider: AIProviderDoc, input: GenerateJSONInput): Promise<string> {
  const apiKey = apiKeyOf(provider)
  if (!apiKey) throw new AIProviderError('Anthropic API key is missing')
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
  const model = provider.model || 'claude-opus-5'
  const isHaiku = model.startsWith('claude-haiku')
  // Server-side refusal fallbacks are available on the Opus 5 / Fable
  // tier — a declined request is re-run on Anthropic's recommended
  // fallback model inside the same call.
  const supportsFallbacks = /^claude-(opus-5|fable-5)/.test(model)

  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: input.maxTokens ?? 4000,
      system: input.system,
      messages: input.messages,
      output_config: {
        format: { type: 'json_schema', schema: input.schema },
        // Chat replies don't need deep reasoning; keeps latency and cost down.
        ...(isHaiku ? {} : { effort: 'low' as const }),
      },
      ...(supportsFallbacks
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    })
    if (response.stop_reason === 'refusal') {
      throw new AIProviderError('The model declined to answer this message')
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) throw new AIProviderError('Empty response from Anthropic')
    return text
  } catch (err) {
    if (err instanceof AIProviderError) throw err
    if (err instanceof Anthropic.AuthenticationError) throw new AIProviderError('Invalid Anthropic API key')
    if (err instanceof Anthropic.RateLimitError) throw new AIProviderError('Anthropic rate limit reached')
    if (err instanceof Anthropic.NotFoundError) throw new AIProviderError(`Unknown Anthropic model "${model}"`)
    if (err instanceof Anthropic.APIError) throw new AIProviderError(`Anthropic error ${err.status}`)
    throw new AIProviderError('Could not reach Anthropic')
  }
}

// ------------------------------------------------------------
// OpenAI-compatible: OpenAI, Groq, OpenRouter, Together, DeepSeek,
// Mistral, Ollama, LM Studio, vLLM...
// ------------------------------------------------------------

function resolveBaseUrl(provider: AIProviderDoc): string {
  const preset = getPreset(provider.preset)
  const base = preset?.customBaseUrl ? provider.baseUrl : (preset?.baseUrl ?? provider.baseUrl)
  if (!base) throw new AIProviderError('Base URL is missing')
  return base.replace(/\/+$/, '')
}

async function openAICompatibleGenerate(
  provider: AIProviderDoc,
  input: GenerateJSONInput,
): Promise<string> {
  const base = resolveBaseUrl(provider)
  const apiKey = apiKeyOf(provider)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  const schemaHint =
    `\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:\n` +
    JSON.stringify(input.schema)
  const body = (withJsonMode: boolean) =>
    JSON.stringify({
      model: provider.model,
      max_tokens: input.maxTokens ?? 1500,
      temperature: 0.3,
      messages: [{ role: 'system', content: input.system + schemaHint }, ...input.messages],
      ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
    })

  const call = (withJsonMode: boolean) =>
    safeFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: body(withJsonMode),
      timeoutMs: 60_000,
      allowPrivate: allowPrivate(),
    })

  let res = await call(true)
  // Some servers reject response_format — retry once without it.
  if (res.status === 400) res = await call(false)
  if (res.status === 401 || res.status === 403) throw new AIProviderError('Invalid API key')
  if (res.status === 404) throw new AIProviderError(`Model "${provider.model}" or endpoint not found`)
  if (res.status === 429) throw new AIProviderError('Provider rate limit reached')
  if (!res.ok) throw new AIProviderError(`Provider error ${res.status}`)

  const json = JSON.parse(res.text) as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new AIProviderError('Empty response from provider')
  return content
}

// ------------------------------------------------------------
// Google Gemini (REST)
// ------------------------------------------------------------

async function geminiGenerate(provider: AIProviderDoc, input: GenerateJSONInput): Promise<string> {
  const apiKey = apiKeyOf(provider)
  if (!apiKey) throw new AIProviderError('Gemini API key is missing')
  if (!/^[a-zA-Z0-9.\-_]+$/.test(provider.model)) throw new AIProviderError('Invalid model name')
  const res = await safeFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: input.maxTokens ?? 1500,
        },
      }),
      timeoutMs: 60_000,
    },
  )
  if (res.status === 400 || res.status === 403) throw new AIProviderError('Gemini rejected the request (check key/model)')
  if (res.status === 429) throw new AIProviderError('Gemini rate limit reached')
  if (!res.ok) throw new AIProviderError(`Gemini error ${res.status}`)
  const json = JSON.parse(res.text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new AIProviderError('Empty response from Gemini')
  return text
}
