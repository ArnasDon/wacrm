// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

/**
 * 'claude-agent-sdk' is the Eter subscription path (see
 * providers/claude-agent-sdk.ts): authenticated with the service's own
 * `CLAUDE_CODE_OAUTH_TOKEN`, never a per-account `api_key`. 'openai' /
 * 'anthropic' stay exactly as they were — bring-your-own-key, unchanged.
 */
export type AiProvider = 'openai' | 'anthropic' | 'claude-agent-sdk'

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
  /**
   * Bloco 3-A — commercial mode for Meta Click-to-WhatsApp ad leads.
   * All four are optional so the many ad-hoc `AiConfig` literals built
   * for the "test key" endpoint and unit tests don't need to know about
   * this feature; `loadAiConfig` always populates them from the row.
   * See src/lib/ai/commercial.ts for the gating logic that reads them.
   */
  /** Master switch for the commercial persona, independent of (but
   *  still gated behind) `autoReplyEnabled`. */
  commercialModeEnabled?: boolean
  /** Business context for the commercial persona (mirrors `systemPrompt`
   *  for the normal persona). The commercial persona only activates
   *  when this is a non-empty string. */
  commercialSystemPrompt?: string | null
  /** Scheduling link handed to a qualified lead. When null, the agent
   *  asks for the lead's email and says the team will follow up —
   *  never invents a link. */
  commercialBookingUrl?: string | null
  /** First message sent immediately (before any AI generation) on a
   *  commercial conversation's first inbound message, to keep the 24h
   *  WhatsApp session window open. Falls back to
   *  DEFAULT_COMMERCIAL_WELCOME_MESSAGE when null/empty. */
  commercialWelcomeMessage?: string | null
  /** Non-null only when the account has a commercial leads calendar
   *  configured (migration 046) — used purely as a prompt-building
   *  signal (buildSystemPrompt's `commercialCalendarConfigured`) so the
   *  model is told to actually book via tools vs. fall back to the
   *  link/email flow. The full scheduling config (busy calendars,
   *  business hours, etc.) is loaded separately by
   *  getCommercialCalendarConfig when a tool call actually runs. */
  commercialCalendarId?: string | null
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
