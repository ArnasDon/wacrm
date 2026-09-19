import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { decrypt } from '@/lib/security/secrets'
import { safeFetch, UnsafeUrlError } from '@/lib/security/safe-fetch'
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

/**
 * Pull the human-readable reason out of a provider error body. Shapes
 * vary: OpenAI {error:{message}}, NVIDIA/FastAPI {detail}, others
 * {message} or {error:"..."}. Trimmed so it fits in the UI.
 */
export function providerErrorDetail(bodyText: string): string {
  let msg = ''
  try {
    const j = JSON.parse(bodyText) as Record<string, unknown>
    const err = j.error as Record<string, unknown> | string | undefined
    msg =
      (typeof err === 'object' && err && typeof err.message === 'string' && err.message) ||
      (typeof err === 'string' && err) ||
      (typeof j.detail === 'string' && j.detail) ||
      (Array.isArray(j.detail) && typeof (j.detail[0] as { msg?: string })?.msg === 'string' && (j.detail[0] as { msg: string }).msg) ||
      (typeof j.message === 'string' && j.message) ||
      (typeof j.title === 'string' && j.title) ||
      ''
  } catch {
    msg = bodyText
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function httpError(status: number, bodyText: string, model: string): AIProviderError {
  const detail = providerErrorDetail(bodyText)
  const withDetail = (base: string) => (detail ? `${base} — ${detail}` : base)
  if (status === 401 || status === 403) return new AIProviderError(withDetail(`Invalid or unauthorised API key (${status})`))
  if (status === 404 || status === 410) {
    return new AIProviderError(
      withDetail(`Model "${model}" is not available (${status}${status === 410 ? ' Gone — the provider retired it' : ''}). Click "Load models" and pick a current one`),
    )
  }
  if (status === 429) return new AIProviderError(withDetail('Rate limit or quota reached (429)'))
  return new AIProviderError(withDetail(`Provider error ${status}`))
}

/**
 * How long a sales reply may take. A WhatsApp customer won't wait longer,
 * and very large reasoning models on free endpoints often queue for minutes.
 */
const CHAT_TIMEOUT_MS = 60_000

function transportError(err: unknown, model: string): AIProviderError {
  if (err instanceof UnsafeUrlError) {
    if (/timed out/i.test(err.message)) {
      return new AIProviderError(
        `"${model}" didn't answer within ${CHAT_TIMEOUT_MS / 1000}s — the provider is overloaded or the model is too slow for live chat. Try a smaller / faster model`,
      )
    }
    return new AIProviderError(`Blocked: ${err.message}`)
  }
  return new AIProviderError('Could not reach the provider — check the URL and your internet connection')
}

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
    if (err instanceof Anthropic.NotFoundError) {
      throw new AIProviderError(`Model "${model}" is not available — click "Load models" and pick a current one`)
    }
    if (err instanceof Anthropic.APIError) {
      throw new AIProviderError(`Anthropic error ${err.status}${err.message ? ` — ${err.message.slice(0, 300)}` : ''}`)
    }
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
      // Reasoning models (gpt-oss, kimi, deepseek…) spend tokens thinking
      // before they answer — leave room so the JSON isn't cut off.
      max_tokens: Math.max(input.maxTokens ?? 4000, 4000),
      temperature: 0.3,
      messages: [{ role: 'system', content: input.system + schemaHint }, ...input.messages],
      ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
    })

  const call = async (withJsonMode: boolean) => {
    try {
      return await safeFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: body(withJsonMode),
        timeoutMs: CHAT_TIMEOUT_MS,
        allowPrivate: allowPrivate(),
      })
    } catch (err) {
      throw transportError(err, provider.model)
    }
  }

  let res = await call(true)
  // Some servers reject response_format — retry once without it.
  if (res.status === 400) res = await call(false)
  if (!res.ok) throw httpError(res.status, res.text, provider.model)

  let json: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> }
  try {
    json = JSON.parse(res.text)
  } catch {
    throw new AIProviderError(`Provider returned something that isn't JSON: ${res.text.slice(0, 200)}`)
  }
  const choice = json.choices?.[0]
  const content = choice?.message?.content
  if (!content) {
    if (choice?.finish_reason === 'length') {
      throw new AIProviderError(
        `Model "${provider.model}" used its whole token budget thinking and returned no answer — choose a faster / non-reasoning model`,
      )
    }
    throw new AIProviderError(`Empty response from "${provider.model}"`)
  }
  return content
}

// ------------------------------------------------------------
// Google Gemini (REST)
// ------------------------------------------------------------

async function geminiGenerate(provider: AIProviderDoc, input: GenerateJSONInput): Promise<string> {
  const apiKey = apiKeyOf(provider)
  if (!apiKey) throw new AIProviderError('Gemini API key is missing')
  if (!/^[a-zA-Z0-9.\-_]+$/.test(provider.model)) throw new AIProviderError('Invalid model name')
  let res
  try {
    res = await safeFetch(
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
  } catch (err) {
    throw transportError(err, provider.model)
  }

  if (!res.ok) throw httpError(res.status, res.text, provider.model)
  const json = JSON.parse(res.text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new AIProviderError('Empty response from Gemini')
  return text
}

// ------------------------------------------------------------
// Live model lists — presets go stale as providers retire models
// (e.g. NVIDIA retiring kimi-k2-instruct → 410), so the settings UI
// can fetch what the provider actually serves for THIS key.
// ------------------------------------------------------------

const NON_CHAT = /(embed|rerank|reward|guard|safety|parse|whisper|tts|speech|audio|image-gen|dall-e|clip|vision-detector|moderation|translate|retriev)/i

export async function listModels(provider: AIProviderDoc): Promise<string[]> {
  const apiKey = apiKeyOf(provider)
  if (provider.kind === 'anthropic') {
    if (!apiKey) throw new AIProviderError('Anthropic API key is missing')
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 })
    try {
      const ids: string[] = []
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id)
      return ids
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new AIProviderError('Invalid Anthropic API key')
      throw new AIProviderError('Could not load models from Anthropic')
    }
  }
  if (provider.kind === 'gemini') {
    if (!apiKey) throw new AIProviderError('Gemini API key is missing')
    const res = await safeFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      timeoutMs: 20_000,
    }).catch((err) => {
      throw transportError(err, 'models')
    })
    if (!res.ok) throw httpError(res.status, res.text, 'models')
    const json = JSON.parse(res.text) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
    return (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
  }
  const base = resolveBaseUrl(provider)
  const res = await safeFetch(`${base}/models`, {
    method: 'GET',
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    timeoutMs: 20_000,
    allowPrivate: allowPrivate(),
  }).catch((err) => {
    throw transportError(err, 'models')
  })
  if (!res.ok) throw httpError(res.status, res.text, 'models')
  let json: { data?: Array<{ id: string }>; models?: Array<{ id?: string; name?: string }> }
  try {
    json = JSON.parse(res.text)
  } catch {
    throw new AIProviderError('The provider’s model list was not JSON')
  }
  const ids = (json.data ?? json.models ?? []).map((m) => ('id' in m && m.id) || ('name' in m && m.name) || '').filter(Boolean) as string[]
  return [...new Set(ids.filter((id) => !NON_CHAT.test(id)))].sort()
}
