import {
  AiError,
  type AgentToolDefinition,
  type AgentToolExecutor,
  type AiUsage,
  type ChatContent,
  type ChatContentPart,
  type ChatMessage,
} from '../types'

// ============================================================
// Bits shared by the OpenAI + Anthropic adapters.
// ============================================================

export interface ProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  timeoutMs: number
  /** Optional agent tools. Providers without tool support may ignore them. */
  tools?: AgentToolDefinition[]
  executeTool?: AgentToolExecutor
}

/**
 * Coerce a provider's usage block into our normalized `AiUsage`, tolerant
 * of missing/partial fields (providers differ and older API versions may
 * omit counts). Returns null when there's nothing usable, so logging can
 * distinguish "no usage reported" from "zero tokens". `total` falls back
 * to prompt + completion when the provider doesn't send it (Anthropic).
 */
export function normalizeUsage(raw: {
  prompt?: unknown
  completion?: unknown
  total?: unknown
}): AiUsage | null {
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  const promptTokens = num(raw.prompt)
  const completionTokens = num(raw.completion)
  const total = num(raw.total)
  const totalTokens = total > 0 ? total : promptTokens + completionTokens
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null
  }
  return { promptTokens, completionTokens, totalTokens }
}

/** Map a fetch rejection (timeout / DNS / offline) to a typed AiError. */
export function toNetworkError(err: unknown): AiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError('The AI provider took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(`Could not reach the AI provider: ${msg}`, {
    code: 'network_error',
    status: 502,
  })
}

/** Build a typed AiError from a non-2xx provider response, pulling the
 *  provider's own error message out of the JSON body when present. */
export async function providerHttpError(provider: string, res: Response): Promise<AiError> {
  let detail = ''
  try {
    const body = (await res.json()) as {
      error?: { message?: string } | string
    }
    detail = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? '')
  } catch {
    // Non-JSON error body — fall back to the status line.
  }

  const { status } = res
  const code =
    status === 401 || status === 403
      ? 'invalid_key'
      : status === 429
        ? 'rate_limited'
        : 'provider_error'
  const base =
    code === 'invalid_key'
      ? `${provider} rejected the API key`
      : code === 'rate_limited'
        ? `${provider} rate limit reached`
        : `${provider} API error (${status})`

  return new AiError(detail ? `${base}: ${detail}` : base, {
    code,
    // Surface an auth failure as 401 so the settings "Test key" button
    // can show "invalid key"; everything else is an upstream 502.
    status: code === 'invalid_key' ? 401 : 502,
  })
}

/**
 * Collapse consecutive same-role turns into one (joined with blank
 * lines). Anthropic requires strictly alternating roles; merging is
 * also harmless for OpenAI and keeps the transcript compact.
 */
export function mergeConsecutive(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      last.content = mergeContent(last.content, m.content)
    } else {
      out.push({ role: m.role, content: cloneContent(m.content) })
    }
  }
  return out
}

function cloneContent(content: ChatContent): ChatContent {
  return typeof content === 'string' ? content : content.map((part) => ({ ...part }))
}

function asParts(content: ChatContent): ChatContentPart[] {
  return typeof content === 'string'
    ? [{ type: 'text', text: content }]
    : content.map((part) => ({ ...part }))
}

function mergeContent(left: ChatContent, right: ChatContent): ChatContent {
  if (typeof left === 'string' && typeof right === 'string') {
    return `${left}\n\n${right}`
  }
  return [...asParts(left), { type: 'text', text: '\n\n' }, ...asParts(right)]
}

export function hasImageContent(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
  )
}

/** Remove pixel inputs while keeping all text placeholders/captions. Used for
 * one silent retry when a configured economical model rejects vision. */
export function withoutImageContent(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') return { ...message }
    const textParts = message.content.filter((part) => part.type === 'text')
    return {
      ...message,
      content:
        textParts.length > 0
          ? textParts.map((part) => ({ ...part }))
          : '[Imagem enviada no WhatsApp; visão indisponível neste modelo]',
    }
  })
}
