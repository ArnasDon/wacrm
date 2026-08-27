// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI, Anthropic or OpenRouter.
// ============================================================

/** Every provider the account may point its BYO key at. `openrouter` is
 *  a gateway rather than a first-party lab: one key, and the `model`
 *  field selects any model in its catalogue (`vendor/model-id`). */
export const AI_PROVIDERS = ['openai', 'anthropic', 'openrouter'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

/** Narrow untrusted input (request body, DB row) to a supported
 *  provider. Keeps the API routes, the UI and the DB CHECK constraint
 *  from drifting apart as providers are added. */
export function isAiProvider(value: unknown): value is AiProvider {
  return (
    typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
  )
}

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing.
 *  `toolCalls` records every tool invocation the provider's internal
 *  tool-calling loop made while producing `text`, in call order — used
 *  by callers (e.g. auto-reply's media side-effect) to react to a
 *  specific tool having run, without re-parsing the model's prose. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
  toolCalls?: ToolCallLogEntry[]
}

/** One completed tool call from a provider's internal tool-calling loop
 *  (see providers/openai-compatible.ts and providers/anthropic.ts). */
export interface ToolCallLogEntry {
  name: string
  input: unknown
  /** The whitelisted result actually sent back to the model — never the
   *  raw provider/ERP payload. */
  result: unknown
}

/**
 * Provider-agnostic tool definition. Each adapter (OpenAI-compatible,
 * Anthropic) translates this into its own wire format
 * (`tools[].function` for OpenAI, `tools[]` with `input_schema` for
 * Anthropic) — see docs/integrations/ai-data-integration/
 * 01_MASTER_EXECUTION.md ("TOOL CALLING").
 */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool's input — `{type:'object', properties, required}`. */
  inputSchema: Record<string, unknown>
}

export interface ToolCallRequest {
  id: string
  name: string
  input: unknown
}

/**
 * Executes one tool call server-side and returns a JSON-serializable
 * result to send back to the model. Must never throw for a business-
 * level failure (not found, invalid args) — return a `{error: "..."}`
 * shape instead, so the model can react in-conversation; reserve
 * throwing for infrastructure failure the caller should treat as the
 * whole generation failing.
 */
export type ToolExecutor = (call: ToolCallRequest) => Promise<unknown>

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
  /** Tool calls made while producing this reply, in call order. Empty
   *  when no `tools` were passed to `generateReply` or the model didn't
   *  use any. */
  toolCalls: ToolCallLogEntry[]
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
