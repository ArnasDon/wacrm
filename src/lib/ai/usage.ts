import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiProvider, AiUsage, ToolCallLogEntry } from './types'
import type { RoutingDecision } from './routing'

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
 * Best-effort append to `ai_usage_log` — one row per LLM call, for cost
 * visibility on the account's BYO key. NEVER throws: usage accounting
 * must not fail a reply the customer is waiting on, so any DB error is
 * logged and swallowed. Skips entirely when the provider didn't report
 * usage (we'd only be writing zeros).
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
  if (!args.usage) return
  try {
    const { error } = await db.from('ai_usage_log').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      mode: args.mode,
      provider: args.provider,
      model: args.model,
      prompt_tokens: args.usage.promptTokens,
      completion_tokens: args.usage.completionTokens,
      total_tokens: args.usage.totalTokens,
      // Anthropic prompt caching (FASE 8) — migration 051. Written as
      // NULL (not 0) whenever the provider didn't report them, exactly
      // like every FASE 2 breakdown metric below: "never computed" and
      // "confirmed zero" must stay distinguishable. Always absent for
      // OpenAI/OpenRouter, which have no such concept.
      cache_creation_input_tokens: args.usage.cacheCreationInputTokens ?? null,
      cache_read_input_tokens: args.usage.cacheReadInputTokens ?? null,
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
    })
    if (error) {
      console.error('[ai usage] log insert failed:', error)
    }
  } catch (err) {
    console.error('[ai usage] log insert threw:', err)
  }
}
