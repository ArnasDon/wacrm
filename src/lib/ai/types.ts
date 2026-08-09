// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

export type ProductQualificationOrder =
  | 'size_then_color'
  | 'color_then_size'

export interface CommercialStrategy {
  maxProducts: number
  preferVisual: boolean
  autoRecommend: boolean
  checkStock: boolean
  keepSelectedProduct: boolean
  qualificationOrder: ProductQualificationOrder
}

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  agentId?: string
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  commercialStrategy: CommercialStrategy
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Quiet period after the latest inbound message before auto-reply runs.
   *  This lets rapid WhatsApp fragments become one model turn. */
  bufferWindowSeconds: number
  /** Maximum number of WhatsApp bubbles sent for one automatic reply. */
  maxReplyChunks: number
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

/** JSON-schema function exposed to a model as an agent tool. */
export interface AgentToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** One provider-requested tool invocation. */
export interface AgentToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * Server-side executor for model-requested tools. It must validate every
 * argument and enforce tenancy/permissions; the model is never trusted as
 * an authority to read or mutate CRM data directly.
 */
export type AgentToolExecutor = (call: AgentToolCall) => Promise<string>

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

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
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
