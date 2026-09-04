import { AiError, type AiUsage, type ChatMessage, type ToolExecutor, type ToolSpec } from '../types'

// ============================================================
// Bits shared by the OpenAI + Anthropic adapters.
// ============================================================

export interface ProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  /** Stable/dynamic split of the SAME system prompt (AI optimization
   *  project, FASE 8) — used ONLY by the Anthropic adapter to mark a
   *  `cache_control` breakpoint on the stable prefix. OpenAI/OpenRouter
   *  never read this field; their wire payload is unaffected either way
   *  — they always use the plain `systemPrompt` string above, exactly
   *  as before this feature existed. Omitted entirely falls back to
   *  today's behavior everywhere, including for Anthropic (plain
   *  string, no caching). See ../defaults.ts::buildSystemPromptBlocks. */
  systemPromptBlocks?: { stable: string; dynamic: string }
  messages: ChatMessage[]
  timeoutMs: number
  /** When set, the adapter declares these tools to the model and runs
   *  its own bounded tool-calling loop (request → tool_calls →
   *  `executeTool` → re-request) before returning. Omitted entirely for
   *  accounts with no catalog source configured — zero wire/behavior
   *  change for everyone else. */
  tools?: ToolSpec[]
  executeTool?: ToolExecutor
  /** Hard cap on model↔tool round trips within one `generateReply` call
   *  (defaults to `MAX_TOOL_TURNS` in ../defaults). Bounds latency and
   *  cost against a model that keeps calling tools instead of
   *  answering. */
  maxToolTurns?: number
}

/**
 * Coerce a provider's usage block into our normalized `AiUsage`, tolerant
 * of missing/partial fields (providers differ and older API versions may
 * omit counts). Returns null when there's nothing usable, so logging can
 * distinguish "no usage reported" from "zero tokens". `total` falls back
 * to prompt + completion when the provider doesn't send it (Anthropic).
 *
 * `cacheCreationInputTokens`/`cacheReadInputTokens` (Anthropic prompt
 * caching, FASE 8) are ONLY included in the returned object when the
 * caller actually passed a real number — never defaulted to 0/null —
 * so an OpenAI/OpenRouter call (which never has this concept) gets back
 * an `AiUsage` with exactly the same 3 keys it always had, and every
 * existing exact-shape assertion (`toEqual({promptTokens, ...})`)
 * elsewhere in the codebase keeps working unchanged.
 */
export function normalizeUsage(raw: {
  prompt?: unknown
  completion?: unknown
  total?: unknown
  cacheCreationInputTokens?: unknown
  cacheReadInputTokens?: unknown
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
  const usage: AiUsage = { promptTokens, completionTokens, totalTokens }
  if (typeof raw.cacheCreationInputTokens === 'number' && Number.isFinite(raw.cacheCreationInputTokens) && raw.cacheCreationInputTokens >= 0) {
    usage.cacheCreationInputTokens = Math.floor(raw.cacheCreationInputTokens)
  }
  if (typeof raw.cacheReadInputTokens === 'number' && Number.isFinite(raw.cacheReadInputTokens) && raw.cacheReadInputTokens >= 0) {
    usage.cacheReadInputTokens = Math.floor(raw.cacheReadInputTokens)
  }
  return usage
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
export async function providerHttpError(
  provider: string,
  res: Response,
): Promise<AiError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } | string }
    detail =
      typeof body?.error === 'string'
        ? body.error
        : (body?.error?.message ?? '')
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
      last.content = `${last.content}\n\n${m.content}`
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}
