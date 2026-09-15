import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { waitForQuietPeriod } from './debounce'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { makeInboundImageResolver, providerSupportsVision } from './inbound-image'
import { retrieveKnowledge } from './knowledge'
import { loadCatalogContext } from './catalog-context'
import { loadHotelStayEstimate } from './hotel-stay-estimate'
import { loadKnownContactFacts, loadActiveReservationsSummary } from './known-context'
import { loadClinicAppointmentContext } from '@/lib/clinic/appointment-context'
import { transitionAppointment } from '@/lib/clinic/appointments'
import { loadQuickReplyContext } from './quick-reply-context'
import { generateReply, isRetryableAiError, type GenerateArgs } from './generate'
import { buildSystemPrompt, aiAutoReplyRetryDelayMs, type AutoReplyCalendarContext } from './defaults'
import { AiError, type AiConfig, type ChatMessage } from './types'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkSharedRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { moveDeal, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { sendCatalogToConversation, SendCatalogError, catalogUrlForConversation } from '@/lib/products/send-catalog'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { sendRestaurantMenuToConversation, SendRestaurantMenuError } from '@/lib/products/send-restaurant-menu'
import { checkFreeBusy, createEvent, APPOINTMENT_LOOKAHEAD_MS } from '@/lib/google-calendar/api'
import { formatWithOffset, describeNowInZone } from '@/lib/timezone'
import { createQuote, CreateQuoteError, type QuoteItemInput } from '@/lib/quotes/create-quote'
import { sendQuoteByAccountPreference, SendQuoteError } from '@/lib/quotes/send-quote'
import { buildReservationFollowUpMessage } from '@/lib/reservations/missing-fields'
import { dispatchSystemAlert, resolveSystemAlert } from '@/lib/observability/alerts'
import { describeError, isUndefinedColumnError } from '@/lib/observability/describe-error'
import {
  upsertReservationRequest,
  categorySlugFromName,
  type ReservationCategory,
  type ReservationInput,
} from '@/lib/reservations/upsert'
import type { LeadTemperature } from '@/types'
import type { GenerateResult } from './types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Phrase-shaped half of the fabricated-appointment-confirmation check
 * below — kept as a first, narrower pass, but a fixed phrase list alone
 * chases the model's wording forever (real incidents, 2026-08-26: first
 * "Confirmo tu demostración... te enviaré el enlace de Google Meet" /
 * "Te agendé a ... recibirás el enlace", then, after this list already
 * covered those, a THIRD wording — "Te envío la invitación en unos
 * minutos. Un asesor de nuestro equipo se conectará contigo" — slipped
 * through it undetected). See `looksLikeFakeAppointmentConfirmation`
 * for the more general signal this is paired with.
 */
const FAKE_APPOINTMENT_CONFIRMATION_RE =
  /\b(confirm(?:o|ada|ado|amos)\b.{0,40}\b(cita|demo|demostraci[oó]n|reuni[oó]n)|te\s+agend[eé]|qued[oóa]n?\s+agendad|(?:tu|la)\s+cita\s+(?:qued[oóa]|est[aá])\s+(?:confirmad|agendad)|(?:te\s+(?:env[ií]o|enviar[eé]|mandar[eé])|recibir[aá]s)\s+(?:la\s+|el\s+)?(?:invitaci[oó]n|enlace|link)|enlace\s+de\s+(?:google\s+)?meet|link\s+de\s+(?:google\s+)?meet|videollamada\s+confirmada|(?:asesor|alguien\s+de\s+(?:nuestro\s+)?equipo).{0,30}(?:se\s+)?conectar[aá]|your\s+(?:appointment|demo|meeting)\s+is\s+(?:booked|confirmed)|i(?:'|’)ve\s+booked\s+you)/i

/** Unanchored email scan (unlike `EMAIL_RE`, which validates a whole
 *  string) — for finding an email address embedded anywhere in a reply. */
const EMBEDDED_EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/

/**
 * True when a reply reads like it's telling the customer their
 * appointment is handled, even though (by the time this runs) we
 * already know no `SCHEDULE_APPOINTMENT_SENTINEL_PREFIX` marker backed
 * it up this turn. A fixed phrase list can't keep up with every way a
 * non-deterministic model might phrase "you're booked" (see the doc
 * comment on `FAKE_APPOINTMENT_CONFIRMATION_RE`), so this pairs it with
 * a second, more general signal: a DECLARATIVE reply (not a question —
 * genuinely asking "what's your email?" ends in "?") that echoes an
 * email address back to the customer. The model has no legitimate
 * reason to state an email in a customer-facing sentence in calendar
 * mode other than confirming where an invite is going — and we already
 * know that invite was never actually created.
 */
function looksLikeFakeAppointmentConfirmation(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.endsWith('?')) return false
  if (FAKE_APPOINTMENT_CONFIRMATION_RE.test(trimmed)) return true
  return EMBEDDED_EMAIL_RE.test(trimmed)
}

/** Loose match for a customer message plainly asking for the catalog or
 *  a price list — mirrors the phrasing `buildSystemPrompt` teaches the
 *  model to react to with `SEND_CATALOG_SENTINEL`. Used only to detect
 *  when the model failed to use a marker it was taught, never to decide
 *  whether to teach it in the first place. */
const CUSTOMER_ASKS_FOR_CATALOG_RE = /\bcat[aá]logo\b|\bcatalog\b|\blista\s+de\s+precios\b|\bprice\s*list\b/i

/** Same idea for the restaurant's food/drink menu. Trailing lookahead
 *  instead of `\b` after the accented "ú" — JS's `\b` is ASCII-only, so
 *  `\bmenú\b` fails to match "menú?" (no boundary between "ú" and "?",
 *  since neither counts as a `\w` character) while still correctly
 *  rejecting "menudo". */
const CUSTOMER_ASKS_FOR_MENU_RE = /\bmen[uú](?![a-zà-ÿ])|\bla\s+carta\b/i

/** A public-catalog URL in either shape: the long `/catalog/<uuid>`
 *  form or the short `/c/<slug>` alias (migration 116), with or without
 *  the signed `?c=` query. The `send_catalog` action delivers the
 *  correct short link as its own message, so any catalog URL the model
 *  pasted into its prose — usually a stale long one copied from earlier
 *  in the thread — is stripped before send. */
const CATALOG_URL_RE =
  /\s*https?:\/\/\S*?\/(?:catalog\/[0-9a-fA-F-]{20,}|c\/[a-z0-9][a-z0-9-]{1,39})(?:\?\S*)?/g

/** Non-global copy of {@link CATALOG_URL_RE} for a stateless presence
 *  check (`.test()` on the `g` regex would advance `lastIndex`). */
const CATALOG_URL_TEST = new RegExp(CATALOG_URL_RE.source, 'i')

/** True when `text` contains at least one public-catalog URL. */
export function hasCatalogUrl(text: string): boolean {
  return CATALOG_URL_TEST.test(text)
}

function tidyAfterUrlEdit(text: string): string {
  return text
    // tidy a now-dangling "…aquí:" / "— " / trailing bullet left behind
    .replace(/[ \t]*[:\-–—][ \t]*$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function stripCatalogUrls(text: string): string {
  return tidyAfterUrlEdit(text.replace(CATALOG_URL_RE, ''))
}

/**
 * Rewrite every catalog URL in `text` to `correctUrl` — the account's
 * CURRENT canonical link. Used when the model answered "here's the
 * catalog" inline (no `send_catalog` action, so nothing else delivers
 * the link) but pasted a URL copied from earlier in the thread, which is
 * dead once the account's `catalog_slug` has changed. A second/third
 * copy of a catalog URL in the same reply collapses to nothing.
 */
export function canonicalizeCatalogUrls(text: string, correctUrl: string): string {
  let replaced = false
  const rewritten = text.replace(CATALOG_URL_RE, (match) => {
    const lead = /^\s*/.exec(match)?.[0] ?? ''
    if (replaced) return ''
    replaced = true
    return `${lead}${correctUrl}`
  })
  return replaced ? tidyAfterUrlEdit(rewritten) : text
}

/** Generic, safe fallback sent instead of a fabricated confirmation —
 *  never promises a time/date that was never actually booked. */
const FAKE_APPOINTMENT_FALLBACK_TEXT =
  'Ya casi tengo todo lo tuyo — dame un momento para confirmar el espacio con el equipo y te aviso apenas quede agendado. 🙌'

/** Sent when the model requested a real clinic appointment mutation but
 * the database rejected it. The original success claim is never sent. */
const CLINIC_APPOINTMENT_ACTION_FALLBACK_TEXT =
  'No pude actualizar tu cita en este momento. Ya avisé a recepción para que lo revise y te confirme por este chat.'

const AI_PROVIDER_FALLBACK_TEXT =
  'Estoy teniendo una dificultad temporal para procesar tu mensaje. Ya avisé al equipo para que te dé seguimiento por este chat.'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Stops the caller's "escribiendo…" loop (direct WhatsApp only —
   *  see src/lib/whatsapp/typing-indicator.ts), called once this
   *  dispatch's own work is done, win or lose. Only `dispatchInboundToAiReply`
   *  itself calls this (in its own `finally`, below); every other
   *  function taking `DispatchArgs` ignores it. Omitted for callers
   *  with nothing to stop (tests, non-WhatsApp channels). */
  stopTyping?: () => void
}

async function sendAiContinuityFallback(args: DispatchArgs): Promise<void> {
  try {
    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: AI_PROVIDER_FALLBACK_TEXT,
      aiGenerated: true,
    })
  } catch (error) {
    // Every OTHER failure path in this file that reaches for this
    // fallback already raises an alert of its own; this send is the one
    // thing they all have in common, and until now its own failure was
    // the sole exception that went silent (console-only). If the channel
    // itself is down at this exact moment, the customer gets NOTHING —
    // no real reply, no holding message either — which is the single
    // worst outcome this whole file exists to avoid. Make it loud.
    console.error('[ai auto-reply] continuity fallback send failed:', error)
    void dispatchSystemAlert({
      severity: 'critical',
      source: 'ai_dispatch_error',
      title: 'AI auto-reply: the continuity fallback message itself failed to send — customer got nothing',
      detail: {
        account_id: args.accountId,
        conversation_id: args.conversationId,
        message: describeError(error).slice(0, 300),
      },
      dedupKey: `ai_fallback_send_failed:${args.accountId}`,
      accountId: args.accountId,
      throttleMinutes: 60,
    })
  }
}

interface ConvEligibility {
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean | null
  ai_reply_count: number | null
  ai_handoff_transient: boolean | null
  ai_handoff_at: string | null
  ai_flow_directive: string | null
}

/** Stable columns that predate every recent AI feature — the eligibility
 *  read still works against these even when a newer column's migration
 *  hasn't landed yet. */
const CONV_ELIGIBILITY_STABLE_COLS = 'assigned_agent_id, ai_autoreply_disabled, ai_reply_count'
const CONV_ELIGIBILITY_ALL_COLS = `${CONV_ELIGIBILITY_STABLE_COLS}, ai_handoff_transient, ai_handoff_at, ai_flow_directive`

/**
 * Read the conversation's AI-eligibility columns. If the full select
 * fails because a column doesn't exist yet — code deployed ahead of its
 * migration, the exact shape of the 2026-09-06 and 2026-09-07 outages —
 * alert loudly and retry with only the columns that have always existed,
 * so the bot keeps replying (minus the just-shipped feature) instead of
 * going account-wide silent. Any other read error → alert + `null` (the
 * caller stands down; replying blind risks answering into a human's
 * thread). A genuine "no such conversation" → `null`, no alert.
 */
async function loadConvEligibility(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ConvEligibility | null> {
  const full = await db
    .from('conversations')
    .select(CONV_ELIGIBILITY_ALL_COLS)
    .eq('id', conversationId)
    .maybeSingle()

  if (!full.error) {
    return full.data ? (full.data as unknown as ConvEligibility) : null
  }

  if (isUndefinedColumnError(full.error)) {
    void dispatchSystemAlert({
      severity: 'critical',
      source: 'ai_dispatch_error',
      title: 'AI auto-reply running in DEGRADED mode — a column is missing (apply the pending migration)',
      detail: {
        account_id: accountId,
        conversation_id: conversationId,
        message: describeError(full.error).slice(0, 300),
      },
      dedupKey: 'ai_schema_drift',
      accountId,
      throttleMinutes: 60,
    })
    const stable = await db
      .from('conversations')
      .select(CONV_ELIGIBILITY_STABLE_COLS)
      .eq('id', conversationId)
      .maybeSingle()
    if (stable.error || !stable.data) return null
    const row = stable.data as unknown as Pick<
      ConvEligibility,
      'assigned_agent_id' | 'ai_autoreply_disabled' | 'ai_reply_count'
    >
    return {
      ...row,
      ai_handoff_transient: null,
      ai_handoff_at: null,
      ai_flow_directive: null,
    }
  }

  console.error('[ai auto-reply] conversation eligibility read failed:', full.error)
  void dispatchSystemAlert({
    severity: 'warning',
    source: 'ai_dispatch_error',
    title: 'AI auto-reply could not read the conversation row',
    detail: {
      account_id: accountId,
      conversation_id: conversationId,
      message: describeError(full.error).slice(0, 300),
    },
    dedupKey: `ai_dispatch_error:${accountId}`,
    accountId,
    throttleMinutes: 60,
  })
  return null
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Debounced first (see debounce.ts): a burst of rapid-fire inbound
 * messages on the same conversation collapses into one reply for the
 * last message in the burst, not one reply per message.
 *
 * Eligibility gates (any → silent no-op):
 *   - superseded by a newer inbound before the debounce quiet period
 *     elapsed
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  // Debounce: coalesce a burst of rapid-fire inbound messages into one
  // reply (see debounce.ts) — stand down silently if a newer inbound on
  // this conversation superseded this call while it waited. Fail OPEN:
  // if the debounce store itself is unreachable, reply now rather than
  // drop the customer's message (worst case a duplicate, far better
  // than silence).
  let isLatest: boolean
  try {
    isLatest = await waitForQuietPeriod(conversationId)
  } catch (err) {
    console.error('[ai auto-reply] debounce check failed, proceeding without it:', err)
    isLatest = true
  }
  if (!isLatest) return

  try {
    const db = supabaseAdmin()

    // A decrypt failure on the stored key throws `AiError('invalid_key')`
    // (see config.ts) — route it to the same owner-notification + ops
    // alert path a rejected key uses, instead of letting it fall into the
    // silent outer catch below (the bot went account-wide dead with zero
    // signal, 2026-08-21 style, before this).
    let config: AiConfig | null
    try {
      config = await loadAiConfig(db, accountId)
    } catch (err) {
      if (err instanceof AiError && err.code === 'invalid_key') {
        await surfaceInvalidKey(db, accountId, err.message)
      } else {
        console.error('[ai auto-reply] loadAiConfig failed:', err)
        void dispatchSystemAlert({
          severity: 'warning',
          source: 'ai_dispatch_error',
          title: 'AI auto-reply could not load its config',
          detail: {
            account_id: accountId,
            conversation_id: conversationId,
            message: describeError(err).slice(0, 300),
          },
          dedupKey: `ai_dispatch_error:${accountId}`,
          accountId,
          throttleMinutes: 60,
        })
      }
      return
    }
    if (!config || !config.autoReplyEnabled) return

    const conv = await loadConvEligibility(db, accountId, conversationId)
    if (!conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) {
      // The bot is paused here. If it was paused by a TRANSIENT fault
      // (migration 115) and a grace period has passed with no human
      // actually replying, give it one more shot rather than parking a
      // working conversation on a person forever.
      if (conv.ai_handoff_transient === true) {
        const recovered = await tryRecoverTransientHandoff({
          db,
          conversationId,
          handoffAt: (conv.ai_handoff_at as string | null) ?? null,
        })
        if (!recovered) return
        // Keep this in-memory eligibility snapshot aligned with the guarded
        // recovery update below. Otherwise a cap-triggered handoff recovers
        // in Postgres but immediately sees the old capped count here and
        // pauses itself again forever.
        conv.ai_autoreply_disabled = false
        conv.ai_reply_count = 0
        // fall through: the bot is re-enabled, handle this inbound normally.
      } else {
        return // explicit handoff / manual pause — leave it to a human.
      }
    }
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound). Reaching the cap
    // used to just go silent forever on this thread — the customer got
    // no reply and no human was ever notified, which is exactly the
    // "AI never handed off" symptom this now fixes: treat running out
    // of auto-reply budget the same as the bot being unable to help,
    // and hand off instead of going quiet.
    if ((conv.ai_reply_count ?? 0) >= config.autoReplyMaxPerConversation) {
      await sendAiContinuityFallback({ accountId, conversationId, contactId, configOwnerUserId })
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary: `🤖 La IA alcanzó su límite de ${config.autoReplyMaxPerConversation} respuestas automáticas en esta conversación y se pausó — necesita seguimiento de un humano.`,
        transient: true,
      })
      return
    }

    // Let the model see photos the customer sent (auto-reply only) when
    // its model line supports vision — downloaded server-side with the
    // account's own WhatsApp creds, using the same BYO AI key. Degrades
    // to text-only on any download/format problem.
    const imageResolver = providerSupportsVision(config.provider, config.model)
      ? makeInboundImageResolver(db, accountId)
      : null
    let messages: ChatMessage[]
    try {
      messages = await buildConversationContext(db, conversationId, undefined, imageResolver)
    } catch (err) {
      // Reading the thread failed. A single oversized / corrupt inbound
      // image feeding the vision resolver is the usual culprit and the
      // resolver is the only new failure surface here — retry text-only
      // once, then give up loudly (alert), never silently.
      console.error('[ai auto-reply] buildConversationContext failed, retrying text-only:', err)
      try {
        messages = await buildConversationContext(db, conversationId, undefined, null)
      } catch (err2) {
        console.error('[ai auto-reply] buildConversationContext failed again (text-only):', err2)
        void dispatchSystemAlert({
          severity: 'warning',
          source: 'ai_dispatch_error',
          title: 'AI auto-reply could not read the conversation',
          detail: {
            account_id: accountId,
            conversation_id: conversationId,
            message: describeError(err2).slice(0, 300),
          },
          dedupKey: `ai_dispatch_error:${accountId}`,
          accountId,
          throttleMinutes: 60,
        })
        // Reading the thread twice failed — don't leave the guest in
        // silence. Route the conversation to a human (transient: the
        // dispatcher may auto-recover the bot once the blip passes).
        await sendAiContinuityFallback({ accountId, conversationId, contactId, configOwnerUserId })
        await handOffToHuman({
          db,
          accountId,
          conversationId,
          handoffAgentId: config.handoffAgentId,
          alreadyAssigned: false,
          summary:
            '🤖 La IA no pudo leer esta conversación y la pasó a una persona. Si fue un fallo temporal, el bot se reactiva solo más tarde.',
          transient: true,
        }).catch((hoErr) => {
          console.error('[ai auto-reply] handoff after context-read failure also failed:', hoErr)
        })
        return
      }
    }
    if (messages.length === 0) return
    // The debounce above (waitForQuietPeriod) should guarantee this
    // dispatch is the only one running for this burst, but the two
    // aren't perfectly atomic: a second dispatch can still read the
    // conversation's history *after* an earlier one already inserted
    // its own reply to the very message that triggered this call. That
    // reply is then the newest row, so the transcript ends on
    // `assistant` — Anthropic flatly rejects that shape (400, not
    // transient — confirmed live 2026-09-03/04) and the retry that
    // follows fails identically, needlessly handing a working
    // conversation to a human. Detect the same signal here and just
    // stand down: whatever this dispatch would have answered has
    // already been answered. (Regenerating instead of standing down
    // would risk the opposite, previously-fixed bug — a duplicate
    // reply to the same customer message; see debounce.ts.)
    if (messages[messages.length - 1].role !== 'user') return

    // Angel's explicit product decision (2026-08-19): the AI must never
    // go quiet because of a message-level automation (`new_message_received`
    // / `keyword_match`). This used to stand the bot down whenever any
    // such automation was merely active on the account — including ones
    // that never matched this message's content, or that never actually
    // messaged the customer at all (e.g. a `move_deal`-only automation) —
    // which produced total, unexplained silence on real conversations. A
    // customer-facing automation firing on the same inbound can now cause
    // a double reply; that tradeoff is accepted in exchange for the bot
    // never silently doing nothing.

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit, send a
    // deterministic reply that does not call the provider and route the
    // conversation for human follow-up instead of leaving it silent.
    const acctLimit = await checkSharedRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — using continuity fallback.`,
      )
      await sendAiContinuityFallback({ accountId, conversationId, contactId, configOwnerUserId })
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary:
          '🤖 La cuenta alcanzó temporalmente el límite de generación de IA. Se envió una respuesta de contingencia y el bot intentará recuperarse automáticamente.',
        transient: true,
      })
      return
    }

    // Everything below this point up to `buildSystemPrompt` is prompt
    // ENRICHMENT — the model can still write a useful reply from the
    // conversation alone. A failure in any of it (a slow query, an RLS
    // hiccup, a malformed KB row, a Google outage) must never drop the
    // customer's message: degrade to a bare prompt, alert, and carry on.
    let knowledge: string[] = []
    let dealStageOptions: Awaited<ReturnType<typeof loadDealStageOptions>> = null
    let catalog: string[] | null = null
    let quickReplies: Awaited<ReturnType<typeof loadQuickReplyContext>> = null
    let catalogDeliveryMode: 'digital' | 'pdf' | 'photos' = 'digital'
    let catalogSlug: string | null = null
    let isHotel = false
    let isClinic = false
    // If account metadata is temporarily unreadable, retain the strict
    // medical prompt. It is safer for a generic account to get one
    // conservative turn than for a clinic bot to diagnose or prescribe.
    let clinicSafetyMode = false
    let hasRestaurantMenu = false
    let businessTimeZone = 'UTC'
    let hotelStayEstimate: string | undefined
    let clinicAppointment: Awaited<ReturnType<typeof loadClinicAppointmentContext>> = null
    let calendarContext: AutoReplyCalendarContext | null = null
    let knownContactFacts: string | null = null
    let activeReservations: string | null = null
    try {
      // Independent reads run concurrently. One failed enrichment must
      // not prevent the other sources from grounding the reply.
      const enrichment = await Promise.allSettled([
        retrieveKnowledge(db, accountId, config, latestUserMessage(messages)),
        loadDealStageOptions({ db, accountId, contactId }),
        loadCatalogContext(db, accountId),
        loadQuickReplyContext(db, accountId),
        loadKnownContactFacts(db, accountId, contactId),
      ])
      if (enrichment[0].status === 'fulfilled') knowledge = enrichment[0].value
      if (enrichment[1].status === 'fulfilled') dealStageOptions = enrichment[1].value
      if (enrichment[2].status === 'fulfilled') catalog = enrichment[2].value
      if (enrichment[3].status === 'fulfilled') quickReplies = enrichment[3].value
      if (enrichment[4].status === 'fulfilled') knownContactFacts = enrichment[4].value

      // How the catalog is delivered (migration 068) + the vertical +
      // whether a restaurant menu PDF is on file (migration 114).
      const { data: catalogModeRow, error: accountMetadataError } = await db
        .from('accounts')
        .select('catalog_delivery_mode, industry_vertical, restaurant_menu_url, timezone, default_currency, catalog_slug')
        .eq('id', accountId)
        .maybeSingle()
      if (accountMetadataError) {
        clinicSafetyMode = true
        throw accountMetadataError
      }
      catalogDeliveryMode =
        (catalogModeRow?.catalog_delivery_mode as 'digital' | 'pdf' | 'photos' | undefined) ?? 'digital'
      catalogSlug = (catalogModeRow?.catalog_slug as string | null | undefined) ?? null
      isHotel = (catalogModeRow?.industry_vertical as string | undefined) === 'hotel'
      isClinic = (catalogModeRow?.industry_vertical as string | undefined) === 'clinica'
      clinicSafetyMode = isClinic
      hasRestaurantMenu = Boolean(
        (catalogModeRow?.restaurant_menu_url as string | null | undefined)?.trim(),
      )
      businessTimeZone = (catalogModeRow?.timezone as string | null | undefined)?.trim() || 'UTC'

      // Hotel: a finished per-night stay total for the room/package the
      // guest is currently asking about, so the bot can answer "¿cuánto
      // sería?" with a real number instead of deferring every quote.
      if (isHotel) {
        const currency = (catalogModeRow?.default_currency as string | undefined) ?? 'USD'
        hotelStayEstimate =
          (await loadHotelStayEstimate(db, accountId, conversationId, currency).catch(
            () => null,
          )) ?? undefined
        activeReservations = await loadActiveReservationsSummary(
          db,
          accountId,
          conversationId,
          currency,
        ).catch(() => null)
      }

      // Clinic: the patient's one upcoming appointment, so the bot can
      // confirm / cancel it straight from the chat.
      if (isClinic) {
        clinicAppointment = await loadClinicAppointmentContext(
          db,
          accountId,
          conversationId,
          businessTimeZone,
        ).catch(() => null)
      }

      // Autonomous Google Calendar scheduling is a generic sales/demo
      // feature. A clinic's source of truth is `appointments`; creating a
      // Google event here would tell the patient they are booked while the
      // clinical calendar remains empty. Keep it disabled for clinics until
      // native appointment creation is wired into the bot.
      calendarContext = isClinic
        ? null
        : await loadCalendarContext({ db, accountId, contactId, config })
      const failed = enrichment.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    } catch (err) {
      console.error('[ai auto-reply] context enrichment failed, replying with a minimal prompt:', err)
      void dispatchSystemAlert({
        severity: 'warning',
        source: 'ai_dispatch_error',
        title: 'AI auto-reply context enrichment failed',
        detail: {
          account_id: accountId,
          conversation_id: conversationId,
          message: describeError(err).slice(0, 300),
        },
        dedupKey: `ai_dispatch_error:${accountId}`,
        accountId,
        throttleMinutes: 60,
      })
    }

    // One-shot instruction from a flow "handoff → AI" node (migration
    // 118) — prepended to the prompt for this reply, then cleared below.
    const flowDirective = (conv.ai_flow_directive as string | null)?.trim() || undefined

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      dealStageOptions,
      catalog,
      calendar: calendarContext,
      catalogDeliveryMode,
      quickReplies,
      askCustomerTaxInfo: config.askCustomerTaxInfo,
      hotelReservations: isHotel,
      restaurantMenu: hasRestaurantMenu,
      hotelStayEstimate,
      clinicGuardrails: clinicSafetyMode,
      clinicAppointment: clinicAppointment
        ? {
            summary: clinicAppointment.summary,
            confirmationStatus: clinicAppointment.confirmationStatus,
          }
        : null,
      currentDate: describeNowInZone(businessTimeZone),
      flowDirective,
      knownContactFacts,
      activeReservations,
    })

    let generation: GenerateResult
    try {
      generation = await generateReplyWithOneRetry({ config, systemPrompt, messages })
    } catch (err) {
      // The provider call failed even after the transient-error retry.
      // Handled here (not the outer catch) so we know it was generation
      // that failed, not the send or an autonomous action below — a bad
      // key notifies the account's admins; anything transient that
      // outlived the retry hands the conversation to a human instead of
      // leaving the customer's question unanswered forever.
      await handleAiGenerationFailure({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        err,
      })
      return
    }
    const {
      text, handoff, markDealWon, moveToStageName, sendCatalog: modelSendCatalog, sendPhotoProductName, sendRestaurantMenu: modelSendRestaurantMenu, leadTemperature, contactName, appointmentProposal, sentinelLeakDetected, quoteProposal, quickReplyId, reservationProposal, appointmentAction, usage,
    } = generation

    // Self-heal a model-compliance gap, not a code bug: `buildSystemPrompt`
    // only teaches SEND_CATALOG_SENTINEL / SEND_RESTAURANT_MENU_SENTINEL
    // when there's real catalog/menu content to send, so the marker was
    // available this turn — the model just didn't use it. Real incident
    // (2026-09-11, gpt-5.4-mini): a customer asked for the catálogo twice
    // and the bot answered "claro, te lo comparto 😊" / "te lo envío
    // enseguida" both times with no marker, so nothing was ever sent —
    // `ai_action_log` shows zero send_catalog attempts across the whole
    // exchange. Unlike a fabricated appointment/booking claim, actually
    // delivering the real catalog/menu carries no risk of telling the
    // customer something false, so rather than only alert, just do what
    // the customer plainly asked for: if THIS turn's inbound reads as a
    // catalog/menu request, the account has one to offer, and the model
    // didn't already send it, send it anyway.
    const latestInbound = latestUserMessage(messages)
    const customerAskedForCatalog = CUSTOMER_ASKS_FOR_CATALOG_RE.test(latestInbound)
    const customerAskedForMenu = CUSTOMER_ASKS_FOR_MENU_RE.test(latestInbound)
    const sendCatalog =
      modelSendCatalog || (!quickReplyId && customerAskedForCatalog && Boolean(catalog?.length))
    const sendRestaurantMenu =
      modelSendRestaurantMenu || (!quickReplyId && hasRestaurantMenu && customerAskedForMenu)
    if (!modelSendCatalog && sendCatalog) {
      console.warn(`[ai auto-reply] conversation ${conversationId}: model asked for the catalog without the marker — sending it anyway`)
      void dispatchSystemAlert({
        severity: 'warning',
        source: 'ai_dispatch_error',
        title: 'AI model failed to emit send_catalog on a turn that plainly asked for it (auto-corrected)',
        detail: { account_id: accountId, conversation_id: conversationId, model: config.model },
        dedupKey: `ai_marker_missed_send_catalog:${accountId}`,
        accountId,
        throttleMinutes: 360,
      })
    }
    if (!modelSendRestaurantMenu && sendRestaurantMenu) {
      console.warn(`[ai auto-reply] conversation ${conversationId}: model asked for the menu without the marker — sending it anyway`)
      void dispatchSystemAlert({
        severity: 'warning',
        source: 'ai_dispatch_error',
        title: 'AI model failed to emit send_restaurant_menu on a turn that plainly asked for it (auto-corrected)',
        detail: { account_id: accountId, conversation_id: conversationId, model: config.model },
        dedupKey: `ai_marker_missed_send_restaurant_menu:${accountId}`,
        accountId,
        throttleMinutes: 360,
      })
    }

    // The provider call succeeded, so the key is valid again — clear any
    // open "AI provider rejected the key" alert for this account.
    void resolveSystemAlert(`ai_key_invalid:${accountId}`)

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Resolve the quick reply the model picked (if any) against the
    // account's real rows — never trust the id blindly (a stray
    // hallucination or a customer-message injection attempt must never
    // put arbitrary text on the wire). Only a 'text'-kind row counts;
    // an unmatched id, an 'interactive' row, or no marker at all all
    // resolve to null and the model's own `text` is used instead. When
    // it does resolve, that row's own `content_text` — never the
    // model's paraphrase — is what actually gets sent, so this
    // conversation's persisted history (and therefore the model's own
    // context on a later turn) reflects exactly what the customer was
    // told, word for word.
    let quickReplyText: { id: string; text: string } | null = null
    if (quickReplyId) {
      const { data: qr } = await db
        .from('quick_replies')
        .select('id, content_text')
        .eq('id', quickReplyId)
        .eq('account_id', accountId)
        .eq('kind', 'text')
        .maybeSingle()
      if (qr?.content_text) quickReplyText = { id: qr.id as string, text: qr.content_text as string }
    }
    let outboundText = quickReplyText?.text ?? text

    // Deal with any catalog URL the model pasted into its prose — almost
    // always copied from earlier in the thread, and DEAD once the
    // account's `catalog_slug` has been renamed (real incident: a bot
    // handed a customer `…/c/demo` after the slug moved to `…/c/villa-…`).
    //   • `send_catalog` fired: `sendCatalogToConversation` (below)
    //     delivers the correct link/files as its own message, so strip
    //     the pasted one — two links, one wrong, helps nobody.
    //   • it did NOT fire (the model answered "here's the catalog"
    //     inline): rewrite every catalog URL to the account's CURRENT
    //     canonical link so the customer never gets a 404.
    if (!quickReplyText && hasCatalogUrl(outboundText)) {
      if (sendCatalog) {
        const stripped = stripCatalogUrls(outboundText)
        // Keep the original if stripping left nothing — the empty check
        // below would otherwise drop the whole turn, catalog send included.
        if (stripped) outboundText = stripped
      } else {
        try {
          outboundText = canonicalizeCatalogUrls(
            outboundText,
            catalogUrlForConversation(accountId, catalogSlug, conversationId),
          )
        } catch {
          // NEXT_PUBLIC_SITE_URL missing → strip rather than crash the turn.
          const stripped = stripCatalogUrls(outboundText)
          if (stripped) outboundText = stripped
        }
      }
    }

    // Defense in depth against a fabricated appointment confirmation:
    // the model told the customer their demo/appointment is booked
    // without emitting SCHEDULE_APPOINTMENT_SENTINEL_PREFIX this turn,
    // so `autoScheduleAppointment` below would never even attempt the
    // real booking. Never let that text reach the customer — send a
    // safe holding message instead and hand off so a human actually
    // books it, rather than the customer believing a Meet link is
    // coming that nobody will ever send.
    const hasActionableClinicAppointment = Boolean(
      appointmentAction && isClinic && clinicAppointment,
    )
    if (
      (calendarContext || clinicSafetyMode) &&
      !appointmentProposal &&
      !hasActionableClinicAppointment &&
      !handoff &&
      looksLikeFakeAppointmentConfirmation(outboundText)
    ) {
      console.error(
        `[ai auto-reply] conversation ${conversationId}: reply looks like a fabricated appointment confirmation with no schedule_appointment marker — withholding it and handing off:`,
        outboundText,
      )
      const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      })
      // A real RPC error (not "lost the cap race") is a deploy problem —
      // fail OPEN so the customer still gets the safe holding message
      // rather than silence, and alert.
      if (claimErr) {
        console.error('[ai auto-reply] claim_ai_reply_slot failed — sending the holding message anyway:', claimErr)
        void alertClaimSlotFailed(accountId, conversationId, claimErr)
      }
      if (claimErr || claimed === true) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: FAKE_APPOINTMENT_FALLBACK_TEXT,
          aiGenerated: true,
        })
      }
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary:
          '🤖 La IA le dijo a este cliente que su cita/demo ya estaba confirmada, pero nunca ejecutó el agendamiento real en Google Calendar — no se envió esa confirmación falsa. Necesita que un humano agende la cita de verdad.',
        transient: true,
      })
      return
    }

    if (!outboundText && !handoff) {
      console.warn(
        `[ai auto-reply] empty reply text for conversation ${conversationId}; sending continuity fallback`,
      )
      await sendAiContinuityFallback({ accountId, conversationId, contactId, configOwnerUserId })
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary:
          '🤖 El proveedor devolvió una respuesta vacía. Se envió una respuesta de contingencia y la conversación quedó visible para seguimiento.',
        transient: true,
      })
      return
    }

    if (handoff) {
      // The customer explicitly asked for a human AND then confirmed
      // it (the two-step protocol taught in `buildSystemPrompt` — the
      // model only ever emits this sentinel on that confirming turn,
      // never on the same turn as the initial request). Stop
      // auto-replying on this thread and hand it to one. We (a) pause
      // the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary,
        transient: false, // the customer really asked for a person — no auto-recovery
      })
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. That used to `return`
      // silently → the customer got nothing, on every inbound, until
      // someone noticed. Fail OPEN instead: the per-conversation cap only
      // bounds cost, it is not a correctness guarantee, so send this one
      // reply anyway and raise an alert so the RPC gets fixed.
      console.error('[ai auto-reply] claim_ai_reply_slot failed — sending anyway (fail-open):', claimErr)
      void alertClaimSlotFailed(accountId, conversationId, claimErr)
    } else if (claimed !== true) {
      return // genuinely lost the per-conversation cap race
    }

    // A clinic confirmation/cancellation changes the database BEFORE the
    // success wording reaches the patient. Previously this ran after the
    // send, so a stale appointment or Supabase failure left the customer
    // believing a change that never happened. On failure, replace the
    // model's claim with a truthful holding message and route the thread to
    // reception; the transient handoff auto-recovers if nobody engages.
    let clinicActionNeedsHandoff = false
    if (appointmentAction && isClinic && clinicAppointment) {
      const next = appointmentAction === 'confirm' ? 'CONFIRMED' : 'CANCELLED'
      let actionResult: Awaited<ReturnType<typeof transitionAppointment>>
      try {
        actionResult = await transitionAppointment(
          db,
          accountId,
          configOwnerUserId,
          clinicAppointment.id,
          next,
          {
            confirmation_status: appointmentAction === 'confirm' ? 'confirmed' : undefined,
            reason: `patient ${appointmentAction} via chat`,
          },
        )
      } catch (err) {
        console.error('[ai auto-reply] autonomous appointment action threw:', err)
        actionResult = { ok: false, error: describeError(err), status: 500 }
      }

      try {
        await db.from('ai_action_log').insert({
          account_id: accountId,
          actor_user_id: configOwnerUserId,
          action: 'appointment_action',
          target_id: clinicAppointment.id,
          input: { action: appointmentAction, source: 'auto_reply_autonomous' },
          result: actionResult.ok ? { status: next } : { error: actionResult.error },
        })
      } catch (err) {
        // Audit logging must not turn a successful patient action into a
        // failed customer turn; the mutation itself remains authoritative.
        console.error('[ai auto-reply] appointment action audit log failed:', err)
      }

      if (!actionResult.ok) {
        console.error(
          `[ai auto-reply] clinic appointment ${clinicAppointment.id} action failed; withholding success text:`,
          actionResult.error,
        )
        outboundText = CLINIC_APPOINTMENT_ACTION_FALLBACK_TEXT
        clinicActionNeedsHandoff = true
      }
    }

    try {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: outboundText,
        aiGenerated: true,
      })
    } catch (err) {
      // The clinic appointment mutation above already committed — the
      // database is correct — but the patient was never actually told,
      // because the channel send itself just failed. Left to the outer
      // catch, this reads as a generic "dispatch threw unexpectedly" and
      // nobody learns WHICH appointment needs a human to call the
      // patient directly. `appointmentAction && !clinicActionNeedsHandoff`
      // means the mutation succeeded (a failed one already handled its
      // own case above and never reaches this send with stale intent).
      if (appointmentAction && isClinic && clinicAppointment && !clinicActionNeedsHandoff) {
        console.error(
          `[ai auto-reply] clinic appointment ${clinicAppointment.id} was updated but the confirmation message failed to send:`,
          err,
        )
        void dispatchSystemAlert({
          severity: 'critical',
          source: 'ai_dispatch_error',
          title: 'Clinic appointment updated, but the patient was never notified (message send failed)',
          detail: {
            account_id: accountId,
            conversation_id: conversationId,
            appointment_id: clinicAppointment.id,
            action: appointmentAction,
            message: describeError(err).slice(0, 300),
          },
          dedupKey: `ai_send_after_mutation_failed:${clinicAppointment.id}`,
          accountId,
          throttleMinutes: 60,
        })
        await handOffToHuman({
          db,
          accountId,
          conversationId,
          handoffAgentId: config.handoffAgentId,
          alreadyAssigned: Boolean(conv.assigned_agent_id),
          summary:
            '🤖 La cita se confirmó/canceló correctamente en el sistema, pero no se pudo enviar el mensaje al paciente (falló el envío del canal). Alguien debe avisarle directamente.',
          transient: true,
        }).catch((hoErr) => {
          console.error('[ai auto-reply] handoff after send-after-mutation failure also failed:', hoErr)
        })
        return
      }
      throw err
    }

    if (clinicActionNeedsHandoff) {
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary:
          '🤖 La IA intentó confirmar o cancelar una cita clínica, pero la base de datos rechazó el cambio. Al paciente se le envió un mensaje seguro, sin afirmar que el cambio se completó. Recepción debe revisar la cita.',
        transient: true,
      })
      return
    }

    // A flow "handoff → AI" directive is one-shot: the reply that just
    // acted on it has gone out, so clear it (guarded so a concurrent
    // fresh directive isn't wiped).
    if (flowDirective) {
      await db
        .from('conversations')
        .update({ ai_flow_directive: null })
        .eq('id', conversationId)
        .eq('ai_flow_directive', conv.ai_flow_directive as string)
    }

    if (sentinelLeakDetected) {
      // The customer already got the cleaned text above, but a
      // `[[...]]` marker survived every named parser — almost
      // certainly means whatever the model was trying to do (build a
      // quote, book something) silently didn't happen. Hand off
      // instead of letting it look like a normal successful turn; see
      // `parseGeneration`'s own doc comment for the 2026-08-25
      // incident this guards against.
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary: `🤖 La respuesta de la IA contenía un marcador interno no reconocido que tuvo que eliminarse antes de enviarse — lo que sea que estaba intentando hacer (p. ej. armar una cotización) probablemente no se completó. Necesita que un humano revise esta conversación.`,
        transient: true,
      })
      return
    }

    if (quickReplyText) {
      try {
        await db.from('ai_action_log').insert({
          account_id: accountId,
          actor_user_id: configOwnerUserId,
          action: 'send_quick_reply',
          target_id: quickReplyText.id,
          input: { quick_reply_id: quickReplyText.id, source: 'auto_reply_autonomous' },
          result: { conversation_id: conversationId },
        })
      } catch (err) {
        console.error('[ai auto-reply] send_quick_reply audit log failed:', err)
      }
    }

    // Autonomous business actions — explicit product decision, no human
    // confirmation gate for any of these (unlike every other business
    // action, which goes through POST /api/ai/actions's two-step
    // confirm flow). All run after the send so a failure here can never
    // prevent the customer-facing reply from going out. The two
    // deal-mutating ones are mutually exclusive per inbound: a purchase
    // confirmation always wins over an ordinary stage-progress signal
    // (the model is told to emit at most one "closing" marker, but code
    // stays defensive about that). Sending the catalog and setting the
    // lead temperature are both independent — neither touches `deals`,
    // so either can fire alongside any of the above.
    if (markDealWon) {
      try {
        await flagDealClosing({ db, accountId, conversationId, configOwnerUserId, handoffAgentId: config.handoffAgentId, alreadyAssigned: Boolean(conv.assigned_agent_id) })
      } catch (err) {
        console.error('[ai auto-reply] flagDealClosing failed:', err)
      }
    } else if (moveToStageName) {
      try {
        await autoMoveDealStage({ db, accountId, contactId, configOwnerUserId, stageName: moveToStageName })
      } catch (err) {
        console.error('[ai auto-reply] autonomous move_deal failed:', err)
      }
    }

    if (sendCatalog) {
      try {
        await sendCatalogToConversation(db, accountId, conversationId)
      } catch (err) {
        // Never rethrow: the customer already got their text reply above,
        // this is a "bonus" delivery on top of it, and every other
        // autonomous action below (menu, temperature, contact name,
        // appointment, quote, reservation) still deserves its own chance
        // to run this turn — a network hiccup here used to `throw` a
        // non-`SendCatalogError` straight to the outer catch, which quietly
        // skipped every action listed after this one. A `SendCatalogError`
        // (no active products, catalog not configured) used to log to the
        // console only, with no alert at all — the bot told the customer
        // "aquí va el catálogo" and then silently delivered nothing.
        const detail = err instanceof SendCatalogError ? err.message : describeError(err)
        console.error('[ai auto-reply] autonomous send_catalog failed:', detail)
        void dispatchSystemAlert({
          severity: 'warning',
          source: 'ai_dispatch_error',
          title: 'AI told a customer "here is the catalog" but it could not be sent',
          detail: {
            account_id: accountId,
            conversation_id: conversationId,
            message: detail.slice(0, 300),
          },
          dedupKey: `ai_send_catalog_failed:${accountId}`,
          accountId,
          throttleMinutes: 60,
        })
      }
    }

    let photoSentProductId: string | null = null
    if (sendPhotoProductName) {
      try {
        photoSentProductId = await autoSendProductPhoto({
          db,
          accountId,
          configOwnerUserId,
          conversationId,
          productName: sendPhotoProductName,
        })
      } catch (err) {
        // Same reasoning as send_catalog above: never rethrow, always
        // alert on an actual send failure (a real product/photo was
        // found — Meta/network is what broke). A no-match or
        // no-photo-on-file isn't an error at all — autoSendProductPhoto
        // itself just returns quietly for those, nothing to catch here.
        console.error('[ai auto-reply] autonomous send_photo failed:', describeError(err))
        void dispatchSystemAlert({
          severity: 'warning',
          source: 'ai_dispatch_error',
          title: 'AI tried to send a product photo but it could not be sent',
          detail: {
            account_id: accountId,
            conversation_id: conversationId,
            message: describeError(err).slice(0, 300),
          },
          dedupKey: `ai_send_photo_failed:${accountId}`,
          accountId,
          throttleMinutes: 60,
        })
      }
    }

    // Defense in depth, same reasoning as the checks below: the marker
    // is only ever taught when `hasRestaurantMenu`, but re-check the URL
    // is really there rather than trusting a marker in the raw output —
    // a hallucination or an injection attempt must not fire a send.
    if (sendRestaurantMenu && hasRestaurantMenu) {
      try {
        await sendRestaurantMenuToConversation(db, accountId, conversationId)
      } catch (err) {
        // Same reasoning as send_catalog above: never rethrow (it would
        // skip every autonomous action still queued after this one), and
        // always alert — an expected `SendRestaurantMenuError` used to be
        // console-only, silently leaving the customer without the menu
        // they were just told was coming.
        const detail = err instanceof SendRestaurantMenuError ? err.message : describeError(err)
        console.error('[ai auto-reply] autonomous send_restaurant_menu failed:', detail)
        void dispatchSystemAlert({
          severity: 'warning',
          source: 'ai_dispatch_error',
          title: 'AI told a customer "here is the menu" but it could not be sent',
          detail: {
            account_id: accountId,
            conversation_id: conversationId,
            message: detail.slice(0, 300),
          },
          dedupKey: `ai_send_restaurant_menu_failed:${accountId}`,
          accountId,
          throttleMinutes: 60,
        })
      }
    }

    if (leadTemperature) {
      try {
        await autoSetLeadTemperature({ db, accountId, contactId, configOwnerUserId, temperature: leadTemperature })
      } catch (err) {
        console.error('[ai auto-reply] autonomous set_temperature failed:', err)
      }
    }

    if (contactName) {
      try {
        await autoSetContactName({ db, accountId, contactId, configOwnerUserId, name: contactName })
      } catch (err) {
        console.error('[ai auto-reply] autonomous set_contact_name failed:', err)
      }
    }

    // Defense in depth: `buildSystemPrompt` only ever teaches the model
    // this marker when the toggle is on (via `calendarContext` above),
    // but re-check it here too rather than trusting that a marker in
    // the raw output implies the account actually opted in — a stray
    // hallucination or a customer-message injection attempt that gets
    // the literal marker text into the reply must never book a real
    // appointment on an account that has this switched off.
    if (appointmentProposal && config.autoScheduleAppointmentsEnabled) {
      try {
        await autoScheduleAppointment({
          db, accountId, contactId, configOwnerUserId, conversationId, proposal: appointmentProposal,
          timeZone: calendarContext?.timeZone ?? 'UTC',
          handoffAgentId: config.handoffAgentId,
          alreadyAssigned: Boolean(conv.assigned_agent_id),
        })
      } catch (err) {
        console.error('[ai auto-reply] autonomous schedule_appointment failed:', err)
      }
    }

    // Defense in depth, same reasoning as the appointment check above:
    // buildSystemPrompt only ever teaches CREATE_QUOTE_SENTINEL_PREFIX
    // when catalogDeliveryMode is 'pdf'/'photos', but re-check here too
    // rather than trusting a marker in the raw output — a stray
    // hallucination or an injection attempt in a customer message must
    // never build a quote on a digital-catalog account, which already
    // has its own self-service cart for this.
    if (quoteProposal && catalogDeliveryMode !== 'digital') {
      try {
        await autoCreateQuoteFromChat({
          db, accountId, contactId, configOwnerUserId, conversationId, proposal: quoteProposal,
          handoffAgentId: config.handoffAgentId,
          alreadyAssigned: Boolean(conv.assigned_agent_id),
        })
      } catch (err) {
        console.error('[ai auto-reply] autonomous create_quote_chat failed:', err)
      }
    }

    // Defense in depth, same reasoning as the checks above: the marker
    // is only ever taught to a `hotel` account, but re-verify here so a
    // stray marker on a non-hotel account never writes a row.
    if (reservationProposal && isHotel) {
      try {
        await autoRecordReservation({
          db, accountId, contactId, conversationId, configOwnerUserId, proposal: reservationProposal,
        })
      } catch (err) {
        console.error('[ai auto-reply] autonomous record_reservation failed:', err)
      }
    }

    // Runs AFTER record_reservation above so it sees this same turn's
    // freshest captured fields, not a stale snapshot from before the
    // marker was processed. See `missingReservationFields` — this is a
    // deterministic, code-level nudge, not left to the model to
    // remember to ask on its own (see `SEND_PRODUCT_PHOTO_SENTINEL_PREFIX`
    // for why: the model doesn't reliably re-invoke actions on later
    // turns in the same conversation).
    if (photoSentProductId && isHotel) {
      try {
        await sendHotelBookingNudge({ db, accountId, conversationId, productId: photoSentProductId })
      } catch (err) {
        console.error('[ai auto-reply] post-photo reservation nudge failed:', err)
      }
    }

  } catch (err) {
    // Last-resort safety net. A provider/generation failure is caught at
    // the `generateReplyWithOneRetry` call site; a config/context/read
    // failure is caught above — so anything reaching here is unexpected
    // (a null deref, an un-guarded DB timeout, a bug). It used to be
    // logged to the server console and NOTHING else, so systemic
    // breakage (a bad deploy, a Supabase incident) looked like "the bot
    // is just quiet". Raise a throttled ops alert too.
    console.error('[ai auto-reply] dispatch failed:', err)
    void dispatchSystemAlert({
      severity: 'warning',
      source: 'ai_dispatch_error',
      title: 'AI auto-reply dispatch threw unexpectedly',
      detail: {
        account_id: accountId,
        conversation_id: conversationId,
        message: describeError(err).slice(0, 300),
      },
      dedupKey: `ai_dispatch_error:${accountId}`,
      accountId,
      throttleMinutes: 60,
    })
  } finally {
    // Only the debounce's eventual winner reaches this — every earlier
    // call in a burst already returned at `if (!isLatest) return`
    // above, before ever touching `stopTyping`, so the shared loop
    // (see typing-indicator.ts's per-conversation dedup) never gets
    // stopped early by a call that did nothing.
    args.stopTyping?.()
  }
}

/** Grace period before the dispatcher will auto-recover a bot that a
 *  transient fault paused (migration 115). Long enough that a human on
 *  shift normally picks the thread up first; short enough that an
 *  after-hours blip doesn't strand the guest overnight. Override with
 *  `AI_TRANSIENT_HANDOFF_RECOVERY_MIN`. */
function transientHandoffRecoveryMs(): number {
  const raw = Number(process.env.AI_TRANSIENT_HANDOFF_RECOVERY_MIN)
  return (Number.isFinite(raw) && raw > 0 ? raw : 30) * 60_000
}

/**
 * A bot that was paused by a TRANSIENT fault (provider timeout, a stray
 * marker, a calendar hiccup, the reply cap — see `handOffToHuman`'s
 * `transient` flag) should not stay off forever. If the grace period has
 * passed and no human has actually replied to the customer since the
 * handoff, re-enable the bot and CONSUME the one-shot recovery (clears
 * `ai_handoff_transient`), so a second transient handoff still waits for
 * a person. Returns true when the bot was re-enabled.
 */
async function tryRecoverTransientHandoff(args: {
  db: SupabaseClient
  conversationId: string
  handoffAt: string | null
}): Promise<boolean> {
  const { db, conversationId, handoffAt } = args
  const since = handoffAt ? Date.parse(handoffAt) : NaN
  if (!Number.isFinite(since)) return false
  if (Date.now() - since < transientHandoffRecoveryMs()) return false

  // Did a person actually engage? Any agent-authored, non-note message
  // after the handoff means a human is on it — leave it to them.
  const { data: humanMsg } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .neq('content_type', 'internal_note')
    .gt('created_at', handoffAt as string)
    .limit(1)
    .maybeSingle()
  if (humanMsg) return false

  // Re-enable + consume the recovery. The `ai_handoff_transient = true`
  // guard makes this a no-op if a concurrent explicit handoff already
  // cleared the flag.
  const { data: updated, error } = await db
    .from('conversations')
    .update({
      ai_autoreply_disabled: false,
      ai_handoff_transient: null,
      ai_reply_count: 0,
    })
    .eq('id', conversationId)
    .eq('ai_handoff_transient', true)
    .select('id')
  if (error) {
    console.error('[ai auto-reply] transient-handoff recovery update failed:', error)
    return false
  }
  if (!updated || updated.length === 0) return false
  console.warn(
    `[ai auto-reply] auto-recovered the bot on conversation ${conversationId} after a transient handoff at ${handoffAt}`,
  )
  return true
}

/** Owner notification + throttled ops alert for a chat key the provider
 *  rejected OR a stored key that won't decrypt — both mean the account's
 *  AI is down until a human re-enters the key. */
async function surfaceInvalidKey(
  db: SupabaseClient,
  accountId: string,
  detail: string,
): Promise<void> {
  console.error('[ai auto-reply] AI provider key unusable:', detail)
  await notifyAiKeyInvalid(db, accountId).catch((notifyErr) => {
    console.error('[ai auto-reply] failed to send invalid-key notification:', notifyErr)
  })
  void dispatchSystemAlert({
    severity: 'critical',
    source: 'ai_key_invalid',
    title: 'AI provider key is unusable — the bot is down for this account',
    detail: { account_id: accountId, message: detail.slice(0, 300) },
    dedupKey: `ai_key_invalid:${accountId}`,
    accountId,
    throttleMinutes: 360,
  })
}

/** Throttled ops alert for a broken `claim_ai_reply_slot` RPC (missing
 *  migration / not EXECUTE-able). The reply is sent fail-open, but this
 *  needs fixing. */
function alertClaimSlotFailed(accountId: string, conversationId: string, err: unknown): void {
  void dispatchSystemAlert({
    severity: 'warning',
    source: 'ai_dispatch_error',
    title: 'claim_ai_reply_slot RPC failed (replies sent fail-open)',
    detail: {
      account_id: accountId,
      conversation_id: conversationId,
      message: describeError(err).slice(0, 300),
    },
    dedupKey: `ai_claim_slot:${accountId}`,
    accountId,
    throttleMinutes: 60,
  })
}

/**
 * The account's configured provider call, retried on a transient failure
 * (429/529/timeout/network/empty). A blip right as a restored key
 * resumes traffic (real incident, 2026-08-30) must not drop the
 * customer's message. A non-retryable error (`invalid_key`,
 * `unsupported_provider`) rethrows immediately with no wait. Retry count
 * is `AI_AUTOREPLY_MAX_RETRIES` (default 2) with a growing backoff — the
 * difference between a customer getting a slightly-late reply and
 * getting a sticky handoff over a 3-second provider hiccup.
 */
function aiAutoReplyMaxRetries(): number {
  const raw = Number(process.env.AI_AUTOREPLY_MAX_RETRIES)
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2
}

async function generateReplyWithOneRetry(args: GenerateArgs): Promise<GenerateResult> {
  const maxRetries = aiAutoReplyMaxRetries()
  const baseDelayMs = aiAutoReplyRetryDelayMs()
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await generateReply(args)
    } catch (err) {
      lastErr = err
      if (!isRetryableAiError(err) || attempt === maxRetries) throw err
      const code = err instanceof AiError ? err.code : 'unknown'
      console.warn(
        `[ai auto-reply] provider call failed transiently (${code}), retry ${attempt + 1}/${maxRetries}:`,
        err instanceof Error ? err.message : err,
      )
      // Linear-ish backoff: 1×, 2×, 3× the base delay.
      const delayMs = baseDelayMs * (attempt + 1)
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the
  // compiler's "not all code paths return".
  throw lastErr
}

/**
 * Terminal handler for a provider call that failed even after
 * `generateReplyWithOneRetry`'s single retry. Two paths:
 *
 *   - `invalid_key` — notify admins/owners, send a deterministic holding
 *     reply that needs no AI, and route the thread to a human while the
 *     key is repaired.
 *
 *   - anything else (timeout / 429 / 5xx / network / empty completion)
 *     that outlived the retry — a transient provider problem. The
 *     customer asked something and the bot has nothing to say, so
 *     rather than going silent forever: hand the conversation to a
 *     human (pauses the bot, routes + notifies, leaves an internal
 *     note) AND raise an `ai_generate_error` ops alert so a recurring
 *     outage is visible, not just a line in the server log.
 */
async function handleAiGenerationFailure(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  config: AiConfig
  alreadyAssigned: boolean
  err: unknown
}): Promise<void> {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    config,
    alreadyAssigned,
    err,
  } = args

  if (err instanceof AiError && err.code === 'invalid_key') {
    // A broken BYO key used to fail exactly like any other AI error —
    // logged to the server console only, customer gets no reply, and
    // nothing in the product itself ever surfaced it (confirmed live
    // 2026-08-21: an account's bot went silently dead for hours,
    // discovered only because a customer complained). Now: owner
    // notification + a critical ops alert (see `surfaceInvalidKey`). A
    // deterministic reply still works because WhatsApp delivery does not
    // depend on the AI provider key.
    await surfaceInvalidKey(db, accountId, err.message)
    await sendAiContinuityFallback({ accountId, conversationId, contactId, configOwnerUserId })
    await handOffToHuman({
      db,
      accountId,
      conversationId,
      handoffAgentId: config.handoffAgentId,
      alreadyAssigned,
      summary:
        '🤖 La clave del proveedor de IA fue rechazada. Se envió una respuesta de contingencia y la conversación necesita seguimiento mientras un administrador corrige la clave.',
      transient: true,
    })
    return
  }

  const code = err instanceof AiError ? err.code : 'unknown'
  const message = describeError(err)
  console.error(`[ai auto-reply] generateReply failed after retry (${code}):`, message)

  void dispatchSystemAlert({
    severity: 'warning',
    source: 'ai_generate_error',
    title: 'AI auto-reply could not generate a response',
    detail: {
      account_id: accountId,
      conversation_id: conversationId,
      code,
      message: message.slice(0, 300),
    },
    dedupKey: `ai_generate_error:${accountId}`,
    accountId,
    throttleMinutes: 60,
  })

  await sendAiContinuityFallback({ accountId, conversationId, contactId, configOwnerUserId })

  await handOffToHuman({
    db,
    accountId,
    conversationId,
    handoffAgentId: config.handoffAgentId,
    alreadyAssigned,
    summary:
      '🤖 La IA tuvo un error temporal con el proveedor y no pudo generar una respuesta (se reintentó una vez). La conversación se pasó a un humano para darle seguimiento.',
    transient: true,
  })
}

/**
 * Alerts the account's admins/owners (the roles allowed to edit AI
 * settings — see `requireRole('admin')` in
 * src/app/api/ai/config/route.ts) that the configured AI provider key
 * is being rejected. Throttled to at most one alert per account per 6h
 * so a sustained outage sends one notification, not one per inbound
 * message.
 */
async function notifyAiKeyInvalid(db: SupabaseClient, accountId: string): Promise<void> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('notifications')
    .select('id')
    .eq('account_id', accountId)
    .eq('type', 'ai_key_invalid')
    .gte('created_at', sixHoursAgo)
    .limit(1)
    .maybeSingle()
  if (recent) return

  const { data: recipients } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .in('account_role', ['owner', 'admin'])
  if (!recipients || recipients.length === 0) return

  await db.from('notifications').insert(
    recipients.map((r) => ({
      account_id: accountId,
      user_id: r.user_id as string,
      type: 'ai_key_invalid',
      title: 'AI auto-reply is down',
      body: 'The AI provider rejected the configured API key, so customers are not getting automatic replies. Check Settings → AI.',
    })),
  )

  // Also feed the operational alert sink (Telegram/email) so the
  // platform operator sees it, not just the account's own admins.
  await dispatchSystemAlert({
    severity: 'warning',
    source: 'ai_key_invalid',
    title: 'AI provider rejected an account API key',
    detail: { account_id: accountId },
    dedupKey: `ai_key_invalid:${accountId}`,
    accountId,
    throttleMinutes: 360,
  })
}

/**
 * Shared conversation-update for every way the bot hands a conversation
 * off to a human: pauses the bot (sticky until re-enabled), records
 * when it happened (drives the dashboard's "average human wait time"
 * card — migration 070), leaves an internal note — both on
 * `conversations.ai_handoff_summary` (the thread banner) and as an
 * actual `internal_note` message row inline in the thread itself
 * (migration 083), so the reason is visible right where an agent is
 * already scrolling, not just in an easy-to-miss banner — and routes
 * to the configured handoff agent unless the thread already has one —
 * never stomps an existing human assignment. Assigning fires the
 * `on_conversation_assigned` trigger, which notifies the agent.
 */
async function handOffToHuman(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  handoffAgentId: string | null
  alreadyAssigned: boolean
  summary: string
  /** True when a TRANSIENT fault caused this (provider timeout, a stray
   *  marker, a calendar hiccup, the reply cap) — the dispatcher may
   *  auto-recover the bot once after a grace period (migration 115).
   *  False (default) for an explicit customer request / manual pause,
   *  which never auto-recovers. Always written, so a later explicit
   *  handoff clears a stale `true` from an earlier recovered one. */
  transient?: boolean
}): Promise<void> {
  const { db, accountId, conversationId, handoffAgentId, alreadyAssigned, summary, transient = false } = args
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: summary,
    ai_handoff_at: new Date().toISOString(),
    ai_handoff_transient: transient ? true : null,
  }
  const willAssign = Boolean(handoffAgentId) && !alreadyAssigned
  if (willAssign) {
    update.assigned_agent_id = handoffAgentId
  }
  const { error: updError } = await db.from('conversations').update(update).eq('id', conversationId)
  if (updError) {
    // The one thing this function MUST do is pause the bot + record the
    // reason. If even that failed, the bot may keep replying into a
    // thread a human was supposed to take — make it loud.
    console.error('[ai auto-reply] handoff conversations.update failed:', updError)
    void dispatchSystemAlert({
      severity: 'warning',
      source: 'ai_dispatch_error',
      title: 'AI handoff could not pause the bot',
      detail: { conversation_id: conversationId, message: updError.message.slice(0, 300) },
      dedupKey: `ai_handoff_fail:${conversationId}`,
      throttleMinutes: 60,
    })
  }

  // Best-effort — a failed insert here must never block the handoff
  // itself (the conversation update above already paused the bot and
  // routed it to a human, which matters far more than the note).
  // Never touches conversations.last_message_text/last_message_at, so
  // the inbox list preview keeps showing the last real exchange, not
  // this note.
  const { error: noteError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content_type: 'internal_note',
    content_text: summary,
    status: 'sent',
  })
  if (noteError) {
    console.error('[ai auto-reply] failed to insert handoff internal note:', noteError)
  }

  // When there's no configured handoff agent AND nobody already owns
  // this thread, `conversations.assigned_agent_id` stays NULL — the
  // `on_conversation_assigned` trigger (migration 027) never fires, so
  // without this the pause is invisible in-app until the idle
  // reassignment sweep happens to run with someone online (up to
  // `unclaimed_conversation_timeout_minutes`, default 60). Notify every
  // agent+ teammate directly instead of waiting on that.
  if (!willAssign && !alreadyAssigned) {
    void notifyHandoffUnassigned(db, accountId, conversationId, summary)
  }
}

/**
 * Best-effort in-app notification for an AI handoff that landed on
 * nobody (migration 136). Mirrors `notifyAiKeyInvalid` below, but goes
 * to every agent+ teammate (not just owner/admin) since any of them
 * can pick up the conversation from the inbox.
 */
async function notifyHandoffUnassigned(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  summary: string,
): Promise<void> {
  try {
    const { data: recipients } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('account_role', ['owner', 'admin', 'agent'])
    if (!recipients || recipients.length === 0) return

    const { error } = await db.from('notifications').insert(
      recipients.map((r) => ({
        account_id: accountId,
        user_id: r.user_id as string,
        type: 'ai_handoff',
        conversation_id: conversationId,
        title: 'AI needs a human',
        body: summary,
      })),
    )
    if (error) {
      console.error('[ai auto-reply] failed to insert ai_handoff notifications:', error)
    }
  } catch (err) {
    console.error('[ai auto-reply] notifyHandoffUnassigned failed:', err)
  }
}

/**
 * Loads the prompt-time stage options for `buildSystemPrompt`. Resolves
 * "which deal is this conversation about" the same way every autonomous
 * action here does: the contact's most recently updated open deal
 * (`deals` has no populated `conversation_id` today).
 *
 * When one exists, returns its current stage + the pipeline's other
 * non-won stage names (`hasDeal: true`) — same as before this contact
 * could also have no deal at all. When there's no open deal, instead
 * offers the account's default pipeline's non-won stage names
 * (`hasDeal: false`, `currentStageName: null`) so the model can still
 * signal real buying interest and `autoMoveDealStage` creates a deal
 * directly at that stage. Returns null only when there's truly nothing
 * to offer (no pipeline configured at all, or a single-stage pipeline).
 */
async function loadDealStageOptions(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
}): Promise<{ hasDeal: boolean; currentStageName: string | null; otherStageNames: string[] } | null> {
  const { db, accountId, contactId } = args

  const { data: deal } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (deal) {
    const preSale = await loadPreSaleStages(db, deal.pipeline_id)
    const current = preSale.find((s) => s.id === deal.stage_id)
    if (!current) return null

    const otherStageNames = preSale.filter((s) => s.id !== deal.stage_id).map((s) => s.name)
    if (otherStageNames.length === 0) return null

    return { hasDeal: true, currentStageName: current.name, otherStageNames }
  }

  const pipeline = await loadDefaultPipeline(db, accountId)
  if (!pipeline) return null

  const preSale = await loadPreSaleStages(db, pipeline.id)
  const otherStageNames = preSale.map((s) => s.name)
  if (otherStageNames.length === 0) return null

  return { hasDeal: false, currentStageName: null, otherStageNames }
}

/**
 * "The account's default pipeline" — oldest one, same convention
 * `createQuote()` uses for a brand-new deal with no pipeline specified.
 * Shared by `loadDealStageOptions` and `autoMoveDealStage` so a
 * newly-created deal always lands in the same pipeline the model was
 * shown stage names from.
 */
async function loadDefaultPipeline(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string } | null> {
  const { data } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

/**
 * The pipeline's pre-sale stages, in position order — every stage
 * strictly BEFORE the won stage. `is_won = false` alone isn't enough:
 * an account can have an operational stage positioned AFTER "won" (e.g.
 * Angel's own "Seguimiento entrega" — delivery follow-up, `is_won:
 * false` but `position` greater than "Venta cerrada"'s), and offering
 * that as a candidate for autonomous move/create would let the model
 * park a still-negotiating deal in a post-sale stage, or treat it as
 * "the most advanced" option when reasoning about progress. Falls back
 * to every non-won stage (old behavior) only if the pipeline has no
 * won stage marked at all.
 */
async function loadPreSaleStages(
  db: SupabaseClient,
  pipelineId: string,
): Promise<{ id: string; name: string }[]> {
  const { data } = await db
    .from('pipeline_stages')
    .select('id, name, is_won')
    .eq('pipeline_id', pipelineId)
    .order('position')
  const all = (data ?? []) as { id: string; name: string; is_won: boolean }[]

  const wonIndex = all.findIndex((s) => s.is_won)
  const preSale = wonIndex === -1 ? all.filter((s) => !s.is_won) : all.slice(0, wonIndex)
  return preSale.map((s) => ({ id: s.id, name: s.name }))
}

/**
 * The customer explicitly confirmed the purchase. By product decision
 * the bot never marks a deal won itself — a person always finalizes a
 * sale — so this hands the conversation off exactly like `HANDOFF_SENTINEL`
 * does (pauses the bot, routes to the configured teammate, leaves a
 * summary) and logs the event to `ai_action_log` so it can be counted
 * on the AI results dashboard. Never touches `deals` at all.
 */
async function flagDealClosing(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  configOwnerUserId: string
  handoffAgentId: string | null
  alreadyAssigned: boolean
}): Promise<void> {
  const { db, accountId, conversationId, configOwnerUserId, handoffAgentId, alreadyAssigned } = args

  await handOffToHuman({
    db,
    accountId,
    conversationId,
    handoffAgentId,
    alreadyAssigned,
    summary:
      '🤖 El cliente confirmó explícitamente la compra. La IA transfirió esta conversación para que un compañero cierre la venta.',
  })

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'flag_deal_closing',
    target_id: conversationId,
    input: { source: 'auto_reply_autonomous' },
    result: { conversation_id: conversationId, handed_off_to: handoffAgentId },
  })
}

/**
 * Resolves "the deal this conversation is about" fresh (same rule as
 * `loadDealStageOptions`). If one exists, moves it to the stage the
 * model named — matched case-insensitively against that deal's own
 * pipeline's non-won stages only, so the model can never route a deal
 * to a stage it wasn't explicitly offered (or to "won" through this
 * path — that's `flagDealClosing`'s job).
 *
 * If the contact has no open deal, this CREATES one directly at the
 * named stage instead (Angel's explicit product decision, 2026-08-16 —
 * previously the bot could only ever advance a deal a human had already
 * created, which left most real conversations invisible to the
 * pipeline). Same default-pipeline resolution as `loadDealStageOptions`,
 * titled after the contact — matching the human "+ New" quick-create
 * convention in the inbox sidebar — with `value: 0` (the bot never
 * invents a price; a linked quote, if any, sets the real value
 * separately via `createQuote`).
 *
 * No-ops quietly whenever the target stage or an actual change can't be
 * resolved; a failure here never affects the already-sent
 * customer-facing reply.
 */
async function autoMoveDealStage(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  stageName: string
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, stageName } = args

  const { data: deal, error: dealErr } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (dealErr) return

  if (deal) {
    const stages = await loadPreSaleStages(db, deal.pipeline_id)
    const target = stages.find(
      (s) => s.name.trim().toLowerCase() === stageName.trim().toLowerCase(),
    )
    if (!target || target.id === deal.stage_id) return

    let moved
    try {
      moved = await moveDeal(db, accountId, deal.id, target.id)
    } catch (err) {
      if (err instanceof MoveDealError) {
        console.error('[ai auto-reply] autonomous move_deal failed:', err.message)
        return
      }
      throw err
    }

    await db.from('ai_action_log').insert({
      account_id: accountId,
      actor_user_id: configOwnerUserId,
      action: 'move_deal',
      target_id: deal.id,
      input: { stageId: target.id, stageName: target.name, source: 'auto_reply_autonomous' },
      result: moved.deal,
    })

    void dispatchWebhookEvent(db, accountId, 'deal.stage_changed', {
      deal_id: moved.deal.id,
      pipeline_id: moved.deal.pipeline_id,
      stage_id: moved.deal.stage_id,
      source: 'auto_reply_autonomous',
    })
    return
  }

  const pipeline = await loadDefaultPipeline(db, accountId)
  if (!pipeline) return

  const stages = await loadPreSaleStages(db, pipeline.id)
  const target = stages.find(
    (s) => s.name.trim().toLowerCase() === stageName.trim().toLowerCase(),
  )
  if (!target) return

  const [{ data: contact }, { data: account }] = await Promise.all([
    db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle(),
    db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
  ])
  const title = contact?.name || contact?.phone || 'Nuevo negocio'

  const { data: created, error: createErr } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      pipeline_id: pipeline.id,
      stage_id: target.id,
      contact_id: contactId,
      title,
      value: 0,
      currency: account?.default_currency ?? 'USD',
      status: 'open',
    })
    .select('*')
    .single()
  if (createErr || !created) {
    console.error('[ai auto-reply] autonomous create_deal failed:', createErr)
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'create_deal',
    target_id: created.id,
    input: { pipelineId: pipeline.id, stageId: target.id, stageName: target.name, source: 'auto_reply_autonomous' },
    result: created,
  })

  void dispatchWebhookEvent(db, accountId, 'deal.stage_changed', {
    deal_id: created.id,
    pipeline_id: created.pipeline_id,
    stage_id: created.stage_id,
    source: 'auto_reply_autonomous',
  })

  // The deal is the "registrado en el CRM" moment — snapshot the
  // contact's captured spec brief to a connected Google Sheet / webhook
  // subscribers. No-op unless the account subscribed to it.
  void dispatchWebhookEvent(db, accountId, 'contact.brief_ready', {
    contact_id: contactId,
    deal_id: created.id,
    source: 'auto_reply_autonomous',
  })
}

/**
 * Sets the contact's `lead_temperature` from the model's own autonomous
 * assessment — no human confirmation, unlike the confirmed
 * `set_lead_temperature` business action (`POST /api/ai/actions`,
 * `src/lib/ai/business-actions.ts`), which still exists as a
 * human-reviewed alternative. Skips the write entirely when the value
 * hasn't changed, so this can safely run on every reply without
 * spamming `ai_action_log` or the webhook with no-op updates.
 */
const RESERVATION_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Logs a hotel reservation/service detail the model surfaced this turn
 * (`RECORD_RESERVATION_SENTINEL_PREFIX`, hotel accounts only) into
 * `reservation_requests` via the shared upsert — one row per
 * (conversation, category), extended field by field across the chat.
 * `upsertReservationRequest` fires `reservation.updated` itself so the
 * Google Sheet row is (re)written. Best-effort; only the fields the
 * model actually gave are written (a sparse later turn never blanks an
 * earlier one).
 */
async function autoRecordReservation(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  configOwnerUserId: string
  proposal: NonNullable<GenerateResult['reservationProposal']>
}): Promise<void> {
  const { db, accountId, contactId, conversationId, configOwnerUserId, proposal } = args
  const f = proposal.fields

  const toInt = (v?: string): number | undefined => {
    if (v == null) return undefined
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
  }
  const toNum = (v?: string): number | undefined => {
    if (v == null) return undefined
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  const toDate = (v?: string): string | undefined =>
    v && RESERVATION_ISO_DATE.test(v) ? v : undefined

  const startNew = ['1', 'true', 'si', 'sí', 'yes', 'nueva'].includes(
    (f.nueva ?? '').trim().toLowerCase(),
  )

  const input: ReservationInput = {
    category: proposal.category as ReservationCategory,
    conversation_id: conversationId,
    contact_id: contactId,
    source: 'ai_chat',
  }
  if (startNew) input.startNew = true
  if (f.servicio) input.service_name = f.servicio
  const guests = toInt(f.personas)
  if (guests !== undefined) input.guests = guests
  const checkIn = toDate(f.entrada)
  if (checkIn) input.check_in = checkIn
  const checkOut = toDate(f.salida)
  if (checkOut) input.check_out = checkOut
  const useDate = toDate(f.fecha)
  if (useDate) input.use_date = useDate
  const minutes = toInt(f.minutos)
  if (minutes !== undefined) input.duration_minutes = minutes
  if (f.salon) input.hall = f.salon
  if (f.decoracion) input.decoration = f.decoracion
  const price = toNum(f.precio)
  if (price !== undefined) input.estimated_price = price

  const id = await upsertReservationRequest(db, accountId, input)
  if (!id) return

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'record_reservation',
    target_id: id,
    input: { category: proposal.category, fields: f, start_new: startNew, source: 'auto_reply_autonomous' },
    result: { reservation_id: id },
  })
}

async function autoSetLeadTemperature(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  temperature: LeadTemperature
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, temperature } = args

  const { data: contact } = await db
    .from('contacts')
    .select('lead_temperature')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!contact || contact.lead_temperature === temperature) return

  const { error } = await db
    .from('contacts')
    .update({ lead_temperature: temperature, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('account_id', accountId)
  if (error) {
    console.error('[ai auto-reply] autonomous set_temperature update failed:', error)
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'set_lead_temperature',
    target_id: contactId,
    input: { temperature, source: 'auto_reply_autonomous' },
    result: { contact_id: contactId, lead_temperature: temperature },
  })

  void dispatchWebhookEvent(db, accountId, 'contact.lead_temperature_changed', {
    contact_id: contactId,
    lead_temperature: temperature,
  })
}

/**
 * Replace the contact's name with the one the customer stated in the
 * chat (`SET_CONTACT_NAME_SENTINEL_PREFIX`). Contacts are created with
 * the WhatsApp profile name, which is often a nickname / "Sarah iPhone"
 * / blank; once the person says who they are, that's what should show
 * in the CRM and — crucially — in the reservations Google Sheet, whose
 * "Cliente" column is read straight off `contacts.name`.
 *
 * Guards hard because the value is model output: trims, collapses
 * whitespace, requires 2–80 chars with at least one letter, and refuses
 * the contact's own phone number. No-ops when the name already matches
 * (case-insensitive). After updating, re-fires `reservation.updated`
 * for every one of this contact's reservations that already has a sheet
 * row, so the sheet's name cell is rewritten in place.
 */
async function autoSetContactName(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  name: string
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, name } = args

  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (clean.length < 2 || !/\p{L}/u.test(clean)) return

  const { data: contact } = await db
    .from('contacts')
    .select('name, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle<{ name: string | null; phone: string | null }>()
  if (!contact) return

  const digits = (s: string) => s.replace(/\D/g, '')
  if (contact.phone && digits(clean) && digits(clean) === digits(contact.phone)) return
  if ((contact.name ?? '').trim().toLowerCase() === clean.toLowerCase()) return

  const { error } = await db
    .from('contacts')
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('account_id', accountId)
  if (error) {
    console.error('[ai auto-reply] autonomous set_contact_name update failed:', error)
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'set_contact_name',
    target_id: contactId,
    input: { name: clean, previous: contact.name ?? null, source: 'auto_reply_autonomous' },
    result: { contact_id: contactId, name: clean },
  })

  // Rewrite the name into any Google Sheet reservation rows already
  // written for this contact (row-builder reads `contacts.name`).
  const { data: rows } = await db
    .from('reservation_requests')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .not('sheet_row', 'is', null)
  for (const r of (rows ?? []) as { id: string }[]) {
    void dispatchWebhookEvent(db, accountId, 'reservation.updated', {
      reservation_id: r.id,
      source: 'ai_chat',
    })
  }
}

/**
 * Sends an active product's full photo gallery (up to 5, `image_urls` —
 * migration 117) into the conversation, resolved by exact
 * (case-insensitive) name against the account's real active `products`
 * — same matching `autoCreateQuoteFromChat` uses, so the model can't
 * send an arbitrary image even if it tried. Falls back to the legacy
 * single `image_url` for a product whose gallery is empty (pre-117
 * data, or written by an older client). Silently returns (no error,
 * nothing sent) when the name doesn't match a real product or that
 * product has no photo on file at all — both are expected, unremarkable
 * outcomes the model's own prompt already accounts for, not something
 * the caller needs to alert on. A genuine send failure (Meta/network,
 * once a real photo was found) is left to throw, so the caller's own
 * alerting fires only for that — note this means a failure partway
 * through a multi-photo gallery leaves the earlier photos sent but
 * unlogged in `ai_action_log`, same tradeoff `sendCatalogToConversation`
 * already accepts for its own photo loop. Returns the sent product's
 * id (so the caller can follow up with `sendHotelBookingNudge`), or
 * `null` for either no-op case above.
 */
async function autoSendProductPhoto(args: {
  db: SupabaseClient
  accountId: string
  configOwnerUserId: string
  conversationId: string
  productName: string
}): Promise<string | null> {
  const { db, accountId, configOwnerUserId, conversationId, productName } = args

  const { data: products } = await db
    .from('products')
    .select('id, name, image_url, image_urls')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const product = (
    (products ?? []) as {
      id: string
      name: string
      image_url: string | null
      image_urls: string[] | null
    }[]
  ).find((p) => p.name.trim().toLowerCase() === productName.trim().toLowerCase())
  if (!product) {
    console.warn(`[ai auto-reply] send_photo: no active product matches "${productName}"`)
    return null
  }
  const photoUrls =
    product.image_urls && product.image_urls.length > 0
      ? product.image_urls
      : product.image_url
        ? [product.image_url]
        : []
  if (photoUrls.length === 0) {
    console.warn(`[ai auto-reply] send_photo: product "${product.name}" has no photo on file`)
    return null
  }

  for (const photoUrl of photoUrls) {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'image',
      mediaUrl: photoUrl,
      contentText: product.name,
      senderType: 'bot',
    })
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'send_photo',
    target_id: product.id,
    input: { product_name: product.name, source: 'auto_reply_autonomous', photo_count: photoUrls.length },
    result: { product_id: product.id, photo_count: photoUrls.length },
  })

  return product.id
}

/**
 * Deterministic post-photo "would you like to book?" nudge (hotel
 * vertical only — called only when `isHotel`). Looks up this product's
 * own `reservation_requests` row for THIS conversation (if the guest,
 * or an earlier `record_reservation` marker this same turn, already
 * started one) — naming what's still missing, or, once nothing is, a
 * full recap (service, dates/guests, estimated price) ending in the
 * confirmation ask (see `buildReservationFollowUpMessage`). A product
 * with no row yet falls back to its catalog category alone, so a guest
 * whose very first message was "send me a photo" still gets asked for
 * dates/guests instead of silence. A product outside the five hotel
 * categories (or one `categorySlugFromName` can't resolve) sends
 * nothing — not every photo is of something bookable.
 */
async function sendHotelBookingNudge(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  productId: string
}): Promise<void> {
  const { db, accountId, conversationId, productId } = args

  const [{ data: row }, { data: account }] = await Promise.all([
    db
      .from('reservation_requests')
      .select('category, service_name, guests, check_in, check_out, use_date, hall, estimated_price')
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .eq('product_id', productId)
      .eq('is_active_build', true)
      .eq('status', 'pending')
      .maybeSingle(),
    db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
  ])

  type Row = {
    category: ReservationCategory
    service_name: string | null
    guests: number | null
    check_in: string | null
    check_out: string | null
    use_date: string | null
    hall: string | null
    estimated_price: number | null
  }

  let snapshot: Row | null = (row as Row | null) ?? null
  if (!snapshot) {
    const { data: product } = await db
      .from('products')
      .select('category_id')
      .eq('id', productId)
      .maybeSingle()
    const categoryId = (product as { category_id: string | null } | null)?.category_id ?? null
    if (!categoryId) return
    const { data: category } = await db
      .from('product_categories')
      .select('name')
      .eq('id', categoryId)
      .maybeSingle()
    const slug = categorySlugFromName((category as { name: string | null } | null)?.name ?? null)
    if (!slug) return
    snapshot = {
      category: slug,
      service_name: null,
      guests: null,
      check_in: null,
      check_out: null,
      use_date: null,
      hall: null,
      estimated_price: null,
    }
  }

  await sendMessageToConversation(db, accountId, {
    conversationId,
    messageType: 'text',
    contentText: buildReservationFollowUpMessage(
      snapshot,
      (account as { default_currency: string | null } | null)?.default_currency ?? 'USD',
    ),
  })
}

/**
 * Loads real Google Calendar free/busy data + the contact's email for
 * `buildSystemPrompt`'s `calendar` param — the AI is only ever shown
 * this (and therefore only ever able to use
 * `SCHEDULE_APPOINTMENT_SENTINEL_PREFIX`) when the account explicitly
 * opted into autonomous scheduling (`auto_schedule_appointments_enabled`)
 * AND has a connected calendar. Returns null in every other case,
 * including a failed freebusy call — that just silently drops the
 * capability for this one reply rather than failing it.
 */
async function loadCalendarContext(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  config: AiConfig
}): Promise<AutoReplyCalendarContext | null> {
  const { db, accountId, contactId, config } = args
  if (!config.autoScheduleAppointmentsEnabled) return null

  const { data: gcalConfig } = await db
    .from('google_calendar_config')
    .select('status')
    .eq('account_id', accountId)
    .maybeSingle()
  if (gcalConfig?.status !== 'connected') return null

  const now = new Date()
  const until = new Date(now.getTime() + APPOINTMENT_LOOKAHEAD_MS)
  try {
    const [busy, contactRow, accountRow] = await Promise.all([
      checkFreeBusy(db, accountId, now.toISOString(), until.toISOString()),
      db.from('contacts').select('email').eq('id', contactId).eq('account_id', accountId).maybeSingle(),
      db.from('accounts').select('timezone').eq('id', accountId).maybeSingle(),
    ])
    const timeZone = (accountRow.data as { timezone: string | null } | null)?.timezone || 'UTC'
    return {
      timeZone,
      now: formatWithOffset(now, timeZone),
      lookaheadUntil: formatWithOffset(until, timeZone),
      // Google's freebusy response is UTC ("Z") — reformat each
      // interval with the same offset as `now`/`lookaheadUntil` so the
      // model reasons about all three in one consistent timezone.
      busy: busy.map((b) => ({
        start: formatWithOffset(new Date(b.start), timeZone),
        end: formatWithOffset(new Date(b.end), timeZone),
      })),
      contactEmail: (contactRow.data as { email: string | null } | null)?.email ?? null,
    }
  } catch (err) {
    console.error('[ai auto-reply] freebusy check failed, dropping autonomous scheduling for this reply:', err)
    return null
  }
}

/**
 * Books the real Google Calendar event the model proposed — the
 * account's chosen autonomous-scheduling path, no human confirmation
 * (unlike the suggest-action + inbox-card flow in
 * src/lib/ai/business-actions.ts's `schedule_appointment`, which
 * always requires one). Re-validates everything against fresh data
 * rather than trusting the model's own text: the datetimes must
 * parse, the slot must still be free (a beat may have passed since
 * `loadCalendarContext`'s snapshot — e.g. a different conversation
 * booked the same slot in between), and the email must look real.
 *
 * The model is instructed to tell the customer the appointment is
 * confirmed in the SAME reply that carries the marker (see
 * `buildSystemPrompt`'s calendar section), and that reply has already
 * been sent by the time this runs — so any failure here means the
 * customer was just told they have a meeting that doesn't actually
 * exist. Every failure path below hands the conversation off to a
 * human instead of silently dropping it (real incident, 2026-08-26 —
 * the model twice fabricated a confirmed appointment; this handles the
 * companion case where the marker WAS present but booking still
 * failed).
 */
async function autoScheduleAppointment(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  conversationId: string
  proposal: { start: string; end: string; email: string }
  /** Account's IANA timezone, for the created event's display timezone
   *  — the actual booked instant is already correct regardless (the
   *  proposal's offset-qualified datetime disambiguates it), this only
   *  affects how the event's time is labeled/rendered in Calendar. */
  timeZone: string
  handoffAgentId: string | null
  alreadyAssigned: boolean
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, conversationId, proposal, timeZone, handoffAgentId, alreadyAssigned } = args

  const handoff = (reason: string) =>
    handOffToHuman({
      db,
      accountId,
      conversationId,
      handoffAgentId,
      alreadyAssigned,
      summary: `🤖 La IA le confirmó una cita a este cliente pero no se logró agendar de verdad en Google Calendar (${reason}). Necesita que un humano la agende o le avise al cliente.`,
      transient: true,
    })

  const start = new Date(proposal.start)
  const end = new Date(proposal.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: invalid start/end, skipping:', proposal)
    await handoff('la fecha/hora que propuso no era válida')
    return
  }
  if (start.getTime() < Date.now() - 60_000) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: proposed slot is in the past, skipping:', proposal)
    await handoff('el horario propuesto ya había pasado')
    return
  }
  if (!EMAIL_RE.test(proposal.email)) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: invalid attendee email, skipping:', proposal)
    await handoff('el correo del asistente no era válido')
    return
  }

  // Idempotency guard against the model re-proposing an appointment it
  // already booked. Real incident (2026-09-01): the customer replied
  // "gracias", the model emitted SCHEDULE_APPOINTMENT_SENTINEL_PREFIX
  // again for the *same slot*, and the freebusy re-check below then saw
  // the event THIS flow had just created as a conflict — handing the
  // conversation off with a misleading "el horario ya no estaba
  // disponible" note even though the appointment was correctly on the
  // calendar. `ai_action_log` only gets a `schedule_appointment` row on
  // a real, successful booking (see below + business-actions.ts), so a
  // row for this contact at the same start instant means "already done"
  // — make this run a silent no-op rather than re-book or false-alarm.
  const { data: priorBookings } = await db
    .from('ai_action_log')
    .select('input')
    .eq('account_id', accountId)
    .eq('action', 'schedule_appointment')
    .eq('target_id', contactId)
    .order('created_at', { ascending: false })
    .limit(20)
  const alreadyBookedSameSlot = (priorBookings ?? []).some((row) => {
    const bookedStart = (row.input as { startTime?: string } | null)?.startTime
    return bookedStart ? new Date(bookedStart).getTime() === start.getTime() : false
  })
  if (alreadyBookedSameSlot) {
    console.info(
      '[ai auto-reply] autonomous schedule_appointment: this slot is already booked for the contact, skipping re-book:',
      proposal,
    )
    return
  }

  let busy: { start: string; end: string }[]
  try {
    busy = await checkFreeBusy(db, accountId, start.toISOString(), end.toISOString())
  } catch (err) {
    console.error('[ai auto-reply] autonomous schedule_appointment: freebusy re-check failed, skipping:', err)
    await handoff('no se pudo verificar la disponibilidad real del calendario')
    return
  }
  const overlaps = busy.some((b) => new Date(b.start) < end && new Date(b.end) > start)
  if (overlaps) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: slot is no longer free, skipping:', proposal)
    await handoff('el horario ya no estaba disponible en el calendario real')
    return
  }

  const { data: contact } = await db
    .from('contacts')
    .select('name')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  let created
  try {
    created = await createEvent(db, accountId, {
      summary: `Cita con ${contact?.name ?? 'cliente'}`,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      attendeeEmail: proposal.email,
      timeZone,
    })
  } catch (err) {
    console.error('[ai auto-reply] autonomous schedule_appointment: createEvent failed:', err)
    await handoff('Google Calendar rechazó la creación del evento')
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'schedule_appointment',
    target_id: contactId,
    input: { startTime: proposal.start, endTime: proposal.end, attendeeEmail: proposal.email, source: 'auto_reply_autonomous' },
    result: { event_id: created.eventId, html_link: created.htmlLink, meet_link: created.meetLink },
  })

  void dispatchWebhookEvent(db, accountId, 'appointment.scheduled', {
    contact_id: contactId,
    event_id: created.eventId,
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'auto_reply_autonomous',
  })
}

/**
 * Builds and sends a quote the model assembled from the chat itself —
 * only reachable when the catalog is delivered as a PDF/photos (see
 * the `catalogDeliveryMode` check at the call site), since the digital
 * catalog page already has its own self-service cart for this.
 *
 * Re-resolves every item name against the account's real, active
 * `products` (case-insensitive exact match) rather than trusting the
 * model's text — an unmatched name is dropped, never invented; if
 * NOTHING matches, or the quote can't be created/sent for any other
 * reason, this hands the conversation to a human instead of aborting
 * silently — a real incident (2026-08-25) had the bot promise "I can
 * prepare your quote now" and then go completely quiet, with nothing
 * in the CRM to show anything had gone wrong. `createQuote({
 * allowFreeItems: false })` is the exact same guard the public
 * catalog's own cart relies on, so a chat-originated quote can't
 * invent a product or price there either even if a name did match by
 * coincidence.
 */
async function autoCreateQuoteFromChat(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  conversationId: string
  proposal: NonNullable<GenerateResult['quoteProposal']>
  handoffAgentId: string | null
  alreadyAssigned: boolean
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, conversationId, proposal, handoffAgentId, alreadyAssigned } = args

  const handoff = (reason: string) =>
    handOffToHuman({
      db,
      accountId,
      conversationId,
      handoffAgentId,
      alreadyAssigned,
      summary: `🤖 La IA le dijo a este cliente que le prepararía una cotización (${proposal.items.map((i) => `${i.name} x${i.qty}`).join(', ')}): ${reason}. Necesita que un humano la complete.`,
      transient: true,
    })

  const { data: products } = await db
    .from('products')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const byName = new Map(
    (products ?? []).map((p) => [String(p.name).trim().toLowerCase(), p.id as string]),
  )

  const items: QuoteItemInput[] = []
  const unmatched: string[] = []
  for (const item of proposal.items) {
    const productId = byName.get(item.name.trim().toLowerCase())
    if (!productId) {
      console.warn(`[ai auto-reply] create_quote_chat: no active product matches "${item.name}", skipping it`)
      unmatched.push(item.name)
      continue
    }
    items.push({ product_id: productId, quantity: item.qty })
  }
  if (items.length === 0) {
    console.warn('[ai auto-reply] create_quote_chat: no item matched a real product, aborting')
    await handoff(`no se logró calzar "${unmatched.join('", "')}" con un producto real del catálogo`)
    return
  }

  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  let created
  try {
    created = await createQuote({
      db,
      accountId,
      userId: configOwnerUserId,
      contactId,
      customerNit: proposal.customerNit,
      customerEmail: proposal.customerEmail,
      customerPhone: contact?.phone ?? '',
      customerAddress: proposal.customerAddress,
      items,
      allowFreeItems: false,
    })
  } catch (err) {
    if (err instanceof CreateQuoteError) {
      console.error('[ai auto-reply] create_quote_chat: createQuote failed:', err.message)
      await handoff(`no se pudo crear la cotización (${err.message})`)
      return
    }
    throw err
  }

  try {
    // Account setting wins; the model's own `format: 'text'` request
    // still forces a text quote even when the account default is PDF.
    await sendQuoteByAccountPreference(
      db,
      accountId,
      created.quote.id,
      conversationId,
      proposal.format === 'text',
      true,
    )
  } catch (err) {
    if (err instanceof SendQuoteError) {
      console.error('[ai auto-reply] create_quote_chat: send failed:', err.message)
      // The quote itself was created (quotes.id above) — only delivery
      // failed, so a human can resend it from Products → Quotes instead
      // of starting over from scratch.
      await handoff(`la cotización (#${created.quote.id.slice(0, 8)}) se creó pero no se pudo enviar (${err.message})`)
      return
    }
    throw err
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'create_quote',
    target_id: created.quote.id,
    input: { items: proposal.items, format: proposal.format, source: 'auto_reply_autonomous' },
    result: { quote_id: created.quote.id, total: created.quote.total },
  })
}
