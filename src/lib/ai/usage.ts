import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError, type AiProvider, type AiUsage, type ToolCallLogEntry } from './types'
import type { RoutingDecision } from './routing'

/** Longest `error_message` this file will ever write — a defensive cap,
 *  not a redaction attempt. `AiError.message` (see providers/shared.ts
 *  ::providerHttpError/toNetworkError) already never embeds the API key
 *  or request headers by construction; this only guards against an
 *  unusually large upstream error body bloating the row. */
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * Classifies an exception caught around `generateReply()` into the
 * short, stable `error_code` this codebase already uses everywhere else
 * (AiError.code — `invalid_key`/`rate_limited`/`provider_error`/
 * `timeout`/`network_error`/`empty_response`/`unsupported_provider`).
 * Reuses that EXISTING taxonomy verbatim rather than inventing a new
 * one (Punto 8, H8-2). A non-`AiError` exception (a genuinely
 * unexpected code path) gets the safe, generic `unknown_error` — never
 * a guessed/invented category. Never returns the raw exception object
 * or anything from it beyond a length-capped message.
 */
export function classifyGenerateFailure(err: unknown): { code: string; message: string } {
  const rawMessage = err instanceof AiError ? err.message : err instanceof Error ? err.message : 'Unknown error'
  const code = err instanceof AiError ? err.code : 'unknown_error'
  const message = rawMessage.length > MAX_ERROR_MESSAGE_LENGTH ? `${rawMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : rawMessage
  return { code, message }
}

export interface LogAiUsageArgs {
  accountId: string
  /** Null for a draft not tied to one thread, or when the row was
   *  deleted between generation and logging. */
  conversationId: string | null
  mode: 'auto_reply' | 'draft'
  provider: AiProvider
  model: string
  /** Provider usage; a no-op when null (nothing worth recording). */
  usage: AiUsage | null
  /** Breakdown metrics — migration 049. All optional and independent of
   *  `usage`: a caller that doesn't compute one simply omits it, and it
   *  is written as NULL rather than a misleading zero/false. This is
   *  what makes an optimization's effect (fewer catalog/Knowledge
   *  attachments, fewer tool calls) measurable per interaction instead
   *  of only as an aggregate token total. */
  toolCallCount?: number
  /** Catalog tools were attached to this call (the account has an
   *  active catalog source) — independent of whether the model actually
   *  called one. */
  catalogAttached?: boolean
  /** At least one catalog tool was actually invoked this call. */
  catalogUsed?: boolean
  /** retrieveKnowledge() returned at least one chunk for this call. */
  knowledgeRetrieved?: boolean
  /** Approximate character count of the KNOWLEDGE BASE prompt section
   *  actually injected (sum of the retrieved chunk texts) — a cheap
   *  proxy for its token cost, not an exact token count. */
  knowledgeChars?: number
  /** Approximate character count of the cross-turn catalog-context
   *  prompt section (src/lib/ai/catalog/context.ts), when present. */
  catalogContextChars?: number
  /** What the routing layer (FASE 5) decided to attach this call, when
   *  routing is active. Left undefined at every call site until then. */
  routingDecision?: RoutingDecision
  /** True when routing decided to omit Knowledge for this call —
   *  distinct from `knowledgeRetrieved: false`, which can also mean
   *  Knowledge was attempted but the account simply has none. */
  knowledgeSkippedByRouting?: boolean
  /** Wall-clock time spent inside `generateReply()` for this call, in
   *  milliseconds — measured by the caller, not the provider adapter. */
  latencyMs?: number
  /** At least one Budun-backed provider was ACTUALLY invoked this call
   *  (the external-call budget allowed it) — migration 052, FASE 12
   *  (observability). Derived by the caller from `toolCalls[].result`'s
   *  `external_used` marker (see tools/catalog-tools.ts) — never a new
   *  query. Distinct from `catalogUsed`, which is true for ANY catalog
   *  tool call regardless of which provider (internal or Budun)
   *  answered it. */
  catalogExternalUsed?: boolean
  /** At least one catalog tool call this turn was blocked by the
   *  external-call budget (`RATE_LIMITS.catalogExternalAccount`) and
   *  returned `external_limit_reached` instead of running — migration
   *  052, FASE 12. Not mutually exclusive with `catalogExternalUsed`:
   *  a `search_all_active` fan-out could have one Budun integration
   *  blocked and another still within budget in the same call. */
  catalogExternalBlocked?: boolean
  /** Punto 8, H8-1 — the provider's raw finish_reason/stop_reason for
   *  the last turn actually executed. See ProviderResult.finishReason
   *  (types.ts) for why this is never normalized across providers. */
  finishReason?: string
  /** Punto 8, H8-1 — true only when MAX_TOOL_TURNS cut the loop off
   *  while the model still wanted another tool. See
   *  ProviderResult.toolTurnsExhausted. */
  toolTurnsExhausted?: boolean
  /** Punto 8, H8-2 — set ONLY when this row represents a FAILED
   *  generateReply() attempt rather than a successful generation. One
   *  of the existing AiError.code values (see classifyGenerateFailure
   *  above), or `unknown_error` for a non-AiError exception. Presence
   *  of this field is what the "usage may be null" exception below
   *  keys off — never set alongside a genuinely successful `usage`. */
  errorCode?: string
  /** Punto 8, H8-2 — short, length-capped description of the failure
   *  (see classifyGenerateFailure) — never a raw provider response
   *  body, never headers, never the API key, never the prompt. */
  errorMessage?: string
}

/**
 * Derive `catalogExternalUsed`/`catalogExternalBlocked` from a turn's
 * own `toolCalls[].result` — the exact JSON the model already received
 * back (catalog-tools.ts's `external_used`/`external_limit_reached`
 * markers, FASE 7/12). Pure and synchronous: no query, no re-derivation
 * of resolver internals, just reading what already happened. Returns
 * `undefined` for a flag that genuinely never applied this turn (no
 * catalog tool call ran at all) — distinct from `false` ("ran, and
 * confirmed neither happened"), matching the NULL-vs-false discipline
 * every other breakdown metric in this file already uses.
 */
export function deriveCatalogExternalFlags(toolCalls: ToolCallLogEntry[]): {
  catalogExternalUsed?: boolean
  catalogExternalBlocked?: boolean
} {
  let catalogExternalUsed: boolean | undefined
  let catalogExternalBlocked: boolean | undefined
  for (const call of toolCalls) {
    const result = call.result
    if (!result || typeof result !== 'object') continue
    const r = result as Record<string, unknown>
    if (r.external_used === true) catalogExternalUsed = true
    if (r.external_limit_reached === true || r.error === 'external_limit_reached') catalogExternalBlocked = true
  }
  return { catalogExternalUsed, catalogExternalBlocked }
}

/**
 * Best-effort append to `ai_usage_log` — one row per generateReply()
 * ATTEMPT (successful or failed), for cost/failure visibility on the
 * account's BYO key. NEVER throws: usage accounting must not fail a
 * reply the customer is waiting on, so any DB error is logged and
 * swallowed. Skips entirely only when there is genuinely nothing worth
 * recording — no usage AND no error (Punto 8, H8-2 relaxed this from
 * "no usage → skip" so a FAILED attempt, which by definition has no
 * usage, still gets a row when the caller passes `errorCode`).
 *
 * Pass the service-role admin client from the webhook, or the RLS-scoped
 * SSR client from a route — writes land either way (there's no
 * `authenticated` INSERT policy, so an SSR write relies on the service
 * role; callers that must persist from a route should pass the admin
 * client).
 */
export async function logAiUsage(
  db: SupabaseClient,
  args: LogAiUsageArgs,
): Promise<void> {
  if (!args.usage && !args.errorCode) return
  try {
    const { error } = await db.from('ai_usage_log').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      mode: args.mode,
      provider: args.provider,
      model: args.model,
      // Punto 8, H8-2 — a failed attempt (args.usage === null, e.g. the
      // provider never responded) writes these as NULL, never 0: it
      // genuinely doesn't know, as opposed to a successful call that
      // measured zero tokens (which cannot happen in practice, but the
      // distinction matters for the column's own semantics).
      prompt_tokens: args.usage?.promptTokens ?? null,
      completion_tokens: args.usage?.completionTokens ?? null,
      total_tokens: args.usage?.totalTokens ?? null,
      // Anthropic prompt caching (FASE 8) — migration 051. Written as
      // NULL (not 0) whenever the provider didn't report them, exactly
      // like every FASE 2 breakdown metric below: "never computed" and
      // "confirmed zero" must stay distinguishable. Absent for OpenAI/
      // OpenRouter unless the provider's own automatic caching kicked
      // in (F-2 — surfaced here as cacheReadInputTokens too, same field
      // Anthropic's cache reads use; `provider` disambiguates which
      // mechanism actually produced it).
      cache_creation_input_tokens: args.usage?.cacheCreationInputTokens ?? null,
      cache_read_input_tokens: args.usage?.cacheReadInputTokens ?? null,
      // Breakdown metrics (migration 049) — each written as NULL when
      // the caller didn't compute it, never coerced to 0/false, so
      // "unknown" and "confirmed absent" stay distinguishable.
      tool_call_count: args.toolCallCount ?? null,
      catalog_attached: args.catalogAttached ?? null,
      catalog_used: args.catalogUsed ?? null,
      knowledge_retrieved: args.knowledgeRetrieved ?? null,
      knowledge_chars: args.knowledgeChars ?? null,
      catalog_context_chars: args.catalogContextChars ?? null,
      routing_decision: args.routingDecision ?? null,
      knowledge_skipped_by_routing: args.knowledgeSkippedByRouting ?? null,
      latency_ms: args.latencyMs ?? null,
      // Budun observability (migration 052, FASE 12) — same NULL-when-
      // not-computed discipline as every field above.
      catalog_external_used: args.catalogExternalUsed ?? null,
      catalog_external_blocked: args.catalogExternalBlocked ?? null,
      // Punto 8 (migration 061) — finish/stop reason and the tool-turns-
      // exhausted flag are purely diagnostic (H8-1); error_code/
      // error_message are only ever set together, on the failure path
      // (H8-2) — never alongside a real `usage`.
      finish_reason: args.finishReason ?? null,
      tool_turns_exhausted: args.toolTurnsExhausted ?? null,
      error_code: args.errorCode ?? null,
      error_message: args.errorMessage ?? null,
    })
    if (error) {
      console.error('[ai usage] log insert failed:', error)
    }
  } catch (err) {
    console.error('[ai usage] log insert threw:', err)
  }
}
