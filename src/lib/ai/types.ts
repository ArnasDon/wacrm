// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

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
  /** Master switch for the AI to autonomously book a real Google
   *  Calendar appointment — no human confirmation — when the customer
   *  clearly wants to schedule one. Off by default; even when true,
   *  `dispatchInboundToAiReply` only offers the capability to the
   *  model when the account's Google Calendar is actually connected. */
  autoScheduleAppointmentsEnabled: boolean
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

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff/action sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** True when the model signaled the customer confirmed the purchase
   *  (auto-reply mode only) — see `MARK_DEAL_WON_SENTINEL`. Hands the
   *  conversation off to a human to close the deal; the bot never marks
   *  a deal won by itself. */
  markDealWon: boolean
  /** The pipeline stage name the model signaled the deal should move to
   *  (auto-reply mode only), or null — see `MOVE_DEAL_SENTINEL_PREFIX`.
   *  Always one of the stage names the model was shown; never the
   *  account's "won" stage (that's `markDealWon`'s job). */
  moveToStageName: string | null
  /** True when the model asked to send the product catalog (auto-reply
   *  mode only) — see `SEND_CATALOG_SENTINEL`. */
  sendCatalog: boolean
  /** The contact's assessed buying-interest temperature (auto-reply
   *  mode only), or null when the model didn't emit a (valid) marker —
   *  see `SET_TEMPERATURE_SENTINEL_PREFIX`. */
  leadTemperature: 'cold' | 'warm' | 'hot' | null
  /** A real appointment slot the model proposed to book autonomously
   *  (auto-reply mode only, account opted in AND Google Calendar
   *  connected), or null — see `SCHEDULE_APPOINTMENT_SENTINEL_PREFIX`.
   *  `start`/`end` are the model's own text, re-validated (parseable,
   *  in-range, non-overlapping) before anything is booked. */
  appointmentProposal: { start: string; end: string; email: string } | null
  /** A quote the model wants to build from the chat itself (auto-reply
   *  mode only, catalog delivery mode 'pdf'/'photos' — see
   *  `CREATE_QUOTE_SENTINEL_PREFIX`), or null. `items` are the model's
   *  own text (product names to resolve against real `products`,
   *  never trusted as-is) — `dispatchInboundToAiReply` re-validates
   *  every item against the real catalog before calling `createQuote`,
   *  same as the digital cart's own quote path. */
  quoteProposal: {
    format: 'pdf' | 'text'
    items: { name: string; qty: number }[]
    customerNit: string
    customerEmail: string
    customerAddress: string
  } | null
  /** The id of a saved quick reply the model picked to answer with
   *  verbatim (auto-reply mode only), or null — see
   *  `QUICK_REPLY_SENTINEL_PREFIX`. Unlike every other marker here, this
   *  one REPLACES `text` rather than trailing it: when it resolves to a
   *  real 'text'-kind quick reply, `dispatchInboundToAiReply` sends that
   *  row's own `content_text` — never the model's paraphrase — so the
   *  conversation's persisted history (and therefore the model's own
   *  context on the next turn) reflects exactly what was actually sent. */
  quickReplyId: string | null
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
