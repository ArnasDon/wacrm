// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

import type { ToolCallRecord } from './tools/types'

/** DeepSeek's Chat Completions API is OpenAI-compatible (same request/
 *  response shape, same tool-calling format) — it's handled by
 *  `providers/deepseek.ts`, a thin wrapper around `generateOpenAi` that
 *  only overrides the base URL. */
export type AiProvider = 'openai' | 'anthropic' | 'deepseek'

/** How readily the auto-reply bot escalates to a human. 'balanced' is
 *  the only level whose prompt wording matches what shipped before this
 *  setting existed (see `buildSystemPrompt`) — it's the default so an
 *  account that never touches this sees no change. */
export type HandoffSensitivity = 'conservative' | 'balanced' | 'assertive'

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
  /** Default 'balanced' — see `HandoffSensitivity`. */
  handoffSensitivity: HandoffSensitivity
  /** Provider sampling temperature (0–1). Null = omit the param and let
   *  the provider use its own default — today's behaviour. */
  temperature: number | null
  /** How many knowledge-base excerpts to retrieve per question. Default
   *  5 (the value that was previously hardcoded). */
  knowledgeTopK: number
  /** Optional 0–1 relevance floor for semantic KB retrieval — higher is
   *  stricter. Null = no filtering, today's behaviour. */
  knowledgeMinRelevance: number | null
  /** How many recent text messages to send verbatim. Default 20 (matches
   *  the previous env-only default). */
  contextMessageLimit: number
  /** When true, messages older than `contextMessageLimit` are folded
   *  into a running summary instead of silently dropped. Default false
   *  — today's behaviour (plain truncation) until an admin opts in. */
  summarizeHistory: boolean
  /** Hours of customer inactivity after which a stale reply-cap/handoff
   *  pause auto-resets (see `src/app/api/ai/cron/route.ts`). Null
   *  (default) = disabled — a pause stays sticky forever until a human
   *  clicks "Resume AI", today's behaviour. Never resets a pause a
   *  human set via "Take over" (`conversations.ai_paused_by_human`). */
  dormancyResetHours: number | null
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
  /** Every tool the model invoked while producing this reply, in order.
   *  Omitted (not an empty array) when no tools were configured or none
   *  were called — keeps the result shape identical to before tool
   *  calling existed for every account that isn't using it. */
  toolCalls?: ToolCallRecord[]
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
