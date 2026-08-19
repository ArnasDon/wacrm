import { AiError, type AiUsage, type ChatMessage } from '../types'
import type { ToolCallRecord, ToolExecutionResult } from '../tools/types'

// ============================================================
// Bits shared by the OpenAI + Anthropic adapters.
// ============================================================

/**
 * Runs one tool call by name; never throws (a failure — bad args,
 * SSRF-blocked, timeout, non-2xx — comes back as a `ToolExecutionResult`
 * with `ok: false` so the model sees it as a tool result, not a crash).
 * Provided by `generate.ts`, which owns the account's `AiTool[]` and
 * wraps `executeTool` per name.
 */
export type ToolRunner = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolExecutionResult>

/**
 * Tool-calling knobs for one `generateReply` call. Omitted entirely
 * when the account has no active tools — that's what guarantees the
 * request an adapter sends is byte-identical to the pre-tool-calling
 * shape for every account that isn't using this.
 */
export interface ToolLoopArgs {
  /** Provider-specific tool definitions, already converted by
   *  `tools/schema.ts` (`toAnthropicTool` / `toOpenAiTool`). */
  toolDefs: unknown[]
  runTool: ToolRunner
  /** Hard cap on tool-use round trips (see `MAX_TOOL_ITERATIONS`). */
  maxIterations: number
  /** Epoch ms after which the loop must stop instead of starting
   *  another round — see `MAX_TOOL_LOOP_MS`. A round already in flight
   *  always finishes; this only gates starting the NEXT one. */
  deadlineAt: number
  /** Called once per executed tool call, in order, so the caller can
   *  persist/display the full transcript. */
  onToolCall: (record: ToolCallRecord) => void
}

export interface ProviderArgs {
  apiKey: string
  model: string
  /** Stable persona/guidelines/handoff/business-context text — see
   *  `SystemPromptResult`. */
  systemPrompt: string
  /** Knowledge-base excerpts for the current question, kept separate
   *  from `systemPrompt` so Anthropic can cache the stable part
   *  independently of turn-to-turn KB variation (see
   *  `providers/anthropic.ts`). OpenAI just appends it after
   *  `systemPrompt` — no behaviour change from before this existed. */
  knowledgeBlock?: string
  /** Condensed summary of conversation history older than the current
   *  window (see `buildContextWithHistorySummary`). Same treatment as
   *  `knowledgeBlock` — its own uncached Anthropic block, folded into
   *  the one system message for OpenAI. Omitted for every account that
   *  hasn't enabled history summarization. */
  historyBlock?: string
  messages: ChatMessage[]
  timeoutMs: number
  /** Present only when the account has active tools. */
  toolLoop?: ToolLoopArgs
  /** Sampling temperature (0–1). Omitted when null/undefined, which
   *  means "don't send the param" — the provider's own default, exactly
   *  today's request shape for every account that hasn't set one. */
  temperature?: number | null
  /** Overrides `MAX_OUTPUT_TOKENS` for this call. Omitted ⇒
   *  `MAX_OUTPUT_TOKENS`, today's behaviour. */
  maxOutputTokens?: number
  /** OpenAI/DeepSeek reasoning-model effort ('low'/'medium'/'high') —
   *  the actual lever for "spend fewer reasoning tokens on this call",
   *  which `maxOutputTokens` is not (see `history-summary.ts`). Omitted
   *  ⇒ no `reasoning_effort` param sent, today's behaviour; a
   *  non-reasoning model on either provider ignores an unrecognized
   *  field harmlessly (both APIs are documented to). Anthropic ignores
   *  this entirely. */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** Overrides the request URL — used by `providers/deepseek.ts` to
   *  point `generateOpenAi` at DeepSeek's (OpenAI-compatible) endpoint
   *  instead of OpenAI's. Omitted ⇒ OpenAI's own URL, today's
   *  behaviour. Anthropic ignores this entirely. */
  baseUrl?: string
  /** Human-readable provider name for error messages ("X rejected the
   *  API key", "X returned an empty response"). Omitted ⇒ "OpenAI",
   *  today's behaviour. */
  providerLabel?: string
}

/** Merge two usage totals (summing across tool-loop round trips). */
export function sumUsage(a: AiUsage | null, b: AiUsage | null): AiUsage | null {
  if (!a) return b
  if (!b) return a
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
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
