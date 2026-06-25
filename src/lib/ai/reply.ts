/**
 * The orchestrator (spec §5: `reply.ts`, §6 runtime flow).
 *
 * `maybeReplyToInbound` is the single entry point the WhatsApp webhook
 * calls (fire-and-forget, after the inbound `messages` row is stored and
 * the Flows dispatch resolves `!flowConsumed`). It composes the rest of
 * `src/lib/ai/` into the gated decision pipeline of spec §6:
 *
 *   load config        → !enabled                  ─▶ skip
 *   load conversation  → ai_handling === false      ─▶ skip (human owns it)
 *   guardrails         → keyword / "talk to human"  ─▶ escalate(keyword), NO LLM call
 *   daily cap          → today's `replied` >= cap   ─▶ escalate(cap_reached)
 *   build prompt + call Claude (forced submit_answer)
 *   decide(result)     → reply  ─▶ send(bot) + log replied
 *                      → else   ─▶ escalate(low_confidence) + log escalated
 *   ANY throw anywhere                              ─▶ escalate(error) + log error
 *
 * The whole body is wrapped in try/catch and this function NEVER throws —
 * any failure (missing API key, Anthropic error, malformed tool_use, DB
 * hiccup, send failure) falls through to a fail-safe escalation to a
 * human, honouring the "any doubt, any error → escalate, never go silent"
 * bias of spec §1. The webhook already runs this off the ack path, so a
 * slow or failing AI call can never delay the Meta 200.
 *
 * Everything that talks to the network or the DB lives in the thin
 * sibling modules (`anthropic`, `send`, `escalate`, `config`,
 * `knowledge-base`) and the service-role admin client — all mocked in
 * `reply.test.ts`. `callAssistant` is injectable so the tests drive the
 * model verdict without a network round-trip (spec §14).
 */

import { type AiReplyDecision } from '@/types'

import { supabaseAdmin } from './admin-client'
import {
  callAssistant as defaultCallAssistant,
  type CallAssistantArgs,
  type CallAssistantResult,
} from './anthropic'
import { loadAiConfig } from './config'
import { decide } from './decide'
import { escalateConversation } from './escalate'
import { shouldForceEscalate } from './guardrails'
import { loadEnabledEntries } from './knowledge-base'
import { buildMessages, buildSystemBlocks, type PromptHistoryMessage } from './prompt'
import { sendAiReply } from './send'

/** Arguments for {@link maybeReplyToInbound}. */
export interface MaybeReplyToInboundArgs {
  /** Tenancy key — scopes config, KB, cap count, contact + reply log. */
  accountId: string
  /** Conversation the inbound message belongs to. */
  conversationId: string
  /** Contact who sent the inbound message (send target + phone lookup). */
  contactId: string
  /** The inbound `messages.id` that triggered this evaluation (audit). */
  messageId: string
  /** The inbound customer text we are deciding how to answer. */
  inboundText: string
  /** Decrypted Meta access token, resolved by the webhook caller. */
  accessToken: string
  /** Meta phone-number id, resolved by the webhook caller. */
  phoneNumberId: string
  /**
   * Injectable model wrapper (default the real {@link defaultCallAssistant}).
   * Tests pass a stub so no network call happens (spec §14).
   */
  callAssistant?: (args: CallAssistantArgs) => Promise<CallAssistantResult>
}

/**
 * How many recent conversation messages to load for the model's context.
 * The prompt assembler caps this again at {@link HISTORY_MESSAGE_LIMIT}
 * (default 10) after dropping empty turns; we over-fetch slightly so a
 * couple of media/empty rows don't starve the usable history window.
 */
const HISTORY_FETCH_LIMIT = 20

/** Fields recorded for one `ai_reply_log` row, beyond the always-set ones. */
interface LogAiReplyArgs {
  accountId: string
  conversationId: string
  messageId: string
  decision: AiReplyDecision
  /** Model self-report; omit (null) when the decision was made pre-LLM. */
  confident?: boolean
  /** Escalation reason / error summary. */
  reason?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  latency_ms?: number
}

/**
 * Insert one audit row into `ai_reply_log` via the service-role client
 * (RLS-bypassing, like the rest of the AI engine — spec §4.4 inserts are
 * service-role only). Best-effort: a logging failure is swallowed so it
 * can never turn a successful reply/escalation into a thrown error. The
 * orchestrator's own try/catch is the safety net for the real work.
 */
async function logAiReply(args: LogAiReplyArgs): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { error } = await db.from('ai_reply_log').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      message_id: args.messageId,
      decision: args.decision,
      confident: args.confident ?? null,
      reason: args.reason ?? null,
      model: args.model ?? null,
      input_tokens: args.input_tokens ?? null,
      output_tokens: args.output_tokens ?? null,
      cache_read_tokens: args.cache_read_tokens ?? null,
      latency_ms: args.latency_ms ?? null,
    })
    if (error) {
      console.error('[ai] logAiReply insert error:', error.message)
    }
  } catch (err) {
    console.error(
      '[ai] logAiReply failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

/** Count today's autonomous replies for an account (UTC-midnight window). */
async function countRepliesToday(accountId: string): Promise<number> {
  const db = supabaseAdmin()
  const since = startOfUtcDay()
  const { count, error } = await db
    .from('ai_reply_log')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('decision', 'replied')
    .gte('created_at', since)
  if (error) {
    // A failed cap read must not let us blow past the cap silently. Treat
    // it as "can't verify" and surface it — the orchestrator's catch turns
    // an unverifiable cap into a fail-safe escalation rather than a send.
    throw new Error(`daily cap count failed: ${error.message}`)
  }
  return count ?? 0
}

/** ISO timestamp for 00:00:00 UTC today — the daily-cap window start. */
function startOfUtcDay(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString()
}

/**
 * Load the recent conversation history projected to the minimal
 * {@link PromptHistoryMessage} shape `prompt.ts` consumes. Oldest→newest.
 * Returns `[]` on any DB error — an empty history is harmless (the model
 * still has the inbound text + the KB), so we don't fail the whole run.
 */
async function loadHistory(
  conversationId: string,
): Promise<PromptHistoryMessage[]> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_FETCH_LIMIT)
  if (error) {
    console.error('[ai] loadHistory error:', error.message)
    return []
  }
  const rows = (data as PromptHistoryMessage[] | null) ?? []
  // Fetched newest→oldest for the LIMIT; reverse to oldest→newest for the
  // prompt (buildMessages expects chronological order).
  return rows.slice().reverse()
}

/** Load the contact's phone (account-scoped) for the escalation handoff send. */
async function loadContactPhone(
  accountId: string,
  contactId: string,
): Promise<string> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as { phone?: string } | null)?.phone ?? ''
}

/**
 * Evaluate one inbound customer message and either reply autonomously or
 * escalate to a human (spec §6). Fire-and-forget from the webhook; this
 * function NEVER throws — every failure path escalates and logs.
 */
export async function maybeReplyToInbound(
  args: MaybeReplyToInboundArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    messageId,
    inboundText,
    accessToken,
    phoneNumberId,
  } = args
  const callAssistant = args.callAssistant ?? defaultCallAssistant

  try {
    // 1. Load config. Missing / disabled config → AI is off for this
    //    account; skip silently (spec §6: `!enabled → skip`).
    const config = await loadAiConfig(accountId)
    if (!config || !config.enabled) {
      await logAiReply({
        accountId,
        conversationId,
        messageId,
        decision: 'skipped',
        reason: !config ? 'no_config' : 'disabled',
      })
      return
    }

    // 2. Load the conversation. If a human has taken over (ai_handling ===
    //    false) the AI stays silent (spec §6: human owns it → skip).
    const db = supabaseAdmin()
    const { data: conversation } = await db
      .from('conversations')
      .select('id, ai_handling')
      .eq('id', conversationId)
      .maybeSingle()
    if (conversation && (conversation as { ai_handling?: boolean }).ai_handling === false) {
      await logAiReply({
        accountId,
        conversationId,
        messageId,
        decision: 'skipped',
        reason: 'human_takeover',
      })
      return
    }

    // The customer phone is needed only by escalate's optional handoff
    // send; resolve it once up front so every escalation branch can use it.
    const customerPhone = await loadContactPhone(accountId, contactId)
    const escalate = (reason: 'keyword' | 'cap_reached' | 'low_confidence' | 'error') =>
      escalateConversation({
        conversationId,
        reason,
        config,
        accessToken,
        phoneNumberId,
        customerPhone,
      })

    // 3. Deterministic guardrails — escalate on a keyword / explicit human
    //    request WITHOUT calling the model (spec §6, cheaper + immune to a
    //    confused model).
    const guard = shouldForceEscalate(inboundText, config.escalation_keywords)
    if (guard.escalate) {
      await escalate('keyword')
      await logAiReply({
        accountId,
        conversationId,
        messageId,
        decision: 'escalated',
        reason: 'keyword',
      })
      return
    }

    // 4. Daily reply cap — escalate when today's autonomous replies have
    //    hit the per-account cap (spec §6, §13). Counted pre-LLM so a
    //    capped account never even calls the model.
    const repliesToday = await countRepliesToday(accountId)
    if (repliesToday >= config.daily_reply_cap) {
      await escalate('cap_reached')
      await logAiReply({
        accountId,
        conversationId,
        messageId,
        decision: 'escalated',
        reason: 'cap_reached',
      })
      return
    }

    // 5. Build the prompt (persona + cached KB block + recent history +
    //    inbound) and call Claude through the forced `submit_answer` tool.
    const [kbEntries, history] = await Promise.all([
      loadEnabledEntries(accountId),
      loadHistory(conversationId),
    ])
    const system = buildSystemBlocks(config, kbEntries)
    const messages = buildMessages(history, inboundText)

    const startedAt = Date.now()
    const result = await callAssistant({ model: config.model, system, messages })
    const latencyMs = Date.now() - startedAt

    // 6. Reduce the model's structured result to a reply / escalate verdict.
    const decision = decide(result)
    if (decision.action === 'reply') {
      await sendAiReply({
        accountId,
        conversationId,
        contactId,
        text: decision.text,
        accessToken,
        phoneNumberId,
      })
      await logAiReply({
        accountId,
        conversationId,
        messageId,
        decision: 'replied',
        confident: result.confident,
        reason: result.reason,
        model: config.model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_read_tokens: result.usage.cache_read_input_tokens,
        latency_ms: latencyMs,
      })
      return
    }

    // Not confident (or confident-but-empty) → hand to a human.
    await escalate('low_confidence')
    await logAiReply({
      accountId,
      conversationId,
      messageId,
      decision: 'escalated',
      confident: result.confident,
      reason: 'low_confidence',
      model: config.model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_tokens: result.usage.cache_read_input_tokens,
      latency_ms: latencyMs,
    })
  } catch (err) {
    // 7. Fail safe to a human (spec §1, §6). ANY throw above — missing API
    //    key, Anthropic error, malformed tool_use, send failure, DB hiccup
    //    — lands here. Escalate and log; never rethrow.
    const summary = err instanceof Error ? err.message : String(err)
    console.error('[ai] maybeReplyToInbound error:', summary)
    try {
      const config = await loadAiConfig(accountId)
      const customerPhone = await loadContactPhone(accountId, contactId)
      if (config) {
        await escalateConversation({
          conversationId,
          reason: 'error',
          config,
          accessToken,
          phoneNumberId,
          customerPhone,
        })
      }
    } catch (escErr) {
      // Even the fail-safe escalation failed — log and swallow. The webhook
      // must not see this function throw under any circumstances.
      console.error(
        '[ai] maybeReplyToInbound escalation-on-error failed:',
        escErr instanceof Error ? escErr.message : escErr,
      )
    }
    await logAiReply({
      accountId,
      conversationId,
      messageId,
      decision: 'error',
      reason: summary,
    })
  }
}
