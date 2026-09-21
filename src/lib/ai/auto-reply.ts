import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply, generateReplyWithTools } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary, sendHandoffNotice } from './handoff'
import { notifyHandoff } from '@/lib/notifications/notify-team'
import {
  checkHandoffReadiness,
  buildMissingInfoNudge,
  shouldForceHandoffThrough,
  DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS,
} from './commercial-handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  isCommercialConversation,
  sendCommercialFallback,
  sendCommercialWelcomeIfNeeded,
} from './commercial'
import { COMMERCIAL_TOOLS } from './tools/commercial-schema'
import { createCommercialToolExecutor } from './tools/handlers/commercial'
import type { GenerateResult } from './types'

/** Base do link da conversa no EterWA, usado no aviso de handoff
 *  (notify-team.ts). O inbox é uma página única que lê a conversa a
 *  abrir por query string (`?c=<conversationId>`), não por rota
 *  `/inbox/<id>` — ver src/app/(dashboard)/inbox/page.tsx. */
const ETERWA_INBOX_URL = process.env.ETERWA_INBOX_URL ?? 'https://eterwa.etergrowth.com/inbox'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
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

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, source, commercial_welcome_sent_at, escalation_reason, handoff_blocked_attempts, team_requested_at',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    // Bloco 3-A — commercial mode is now the DEFAULT persona for anyone
    // who writes, from an ad referral or directly, once the account
    // turned it on and configured a commercial prompt. The only
    // exception is a phone number on the team list
    // (`config.teamPhoneNumbers`), which always gets the internal
    // persona instead — see isCommercialConversation.
    const { data: contactRow } = await db
      .from('contacts')
      .select('phone, name, email, company')
      .eq('id', contactId)
      .maybeSingle()
    const isCommercial = isCommercialConversation(config, contactRow?.phone ?? null)

    if (isCommercial) {
      // Sent FIRST, unconditionally, before any AI call — guarantees a
      // reply lands inside WhatsApp's 24h session window even if the AI
      // generation below is slow, times out, or fails outright. See
      // sendCommercialWelcomeIfNeeded's doc comment for why. Never
      // throws, so a send failure here still lets the AI reply below
      // attempt to run.
      await sendCommercialWelcomeIfNeeded({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        welcomeMessage: config.commercialWelcomeMessage,
      })
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: isCommercial ? config.commercialSystemPrompt ?? null : config.systemPrompt,
      mode: isCommercial ? 'commercial_reply' : 'auto_reply',
      knowledge,
      commercialBookingUrl: isCommercial ? config.commercialBookingUrl : undefined,
      commercialCalendarConfigured: isCommercial ? !!config.commercialCalendarId : undefined,
      teamAlreadyRequested: isCommercial ? !!conv.team_requested_at : undefined,
    })

    // The 24h-window guarantee (see sendCommercialWelcomeIfNeeded above)
    // extends to the substantive reply too: if the provider call throws
    // (network error, invalid key, or the AiError timeout wrapper in
    // aiRequestTimeoutMs) we must not leave the lead in silence — send a
    // short fixed fallback instead of letting the exception bubble to
    // this function's outer catch (which would just log and return).
    // Non-commercial conversations keep today's behaviour exactly:
    // rethrow so the outer catch handles it the way it always has.
    let generation: GenerateResult
    try {
      if (isCommercial) {
        // Bloco 3-A — real scheduling. The commercial persona gets its
        // own small tool set (check_commercial_availability /
        // book_commercial_meeting, against the dedicated leads
        // calendar) via the agentic tool-calling loop. Non-commercial
        // conversations never take this branch — they keep calling
        // plain `generateReply` exactly as before, no tools at all.
        generation = await generateReplyWithTools({
          config,
          systemPrompt,
          messages,
          tools: COMMERCIAL_TOOLS,
          executor: createCommercialToolExecutor({
            db,
            accountId,
            conversationId,
            contactId,
            defaultNotifyUserId: config.handoffAgentId ?? null,
          }),
        })
      } else {
        generation = await generateReply({ config, systemPrompt, messages })
      }
    } catch (err) {
      if (isCommercial) {
        console.error(
          '[ai auto-reply] commercial mode: geração falhou ou expirou — a enviar fallback:',
          err instanceof Error ? err.message : err,
        )
        await sendCommercialFallback({
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
        })
        return
      }
      throw err
    }
    const { text, handoff, usage } = generation

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way. Always logged as 'auto_reply' — the DB CHECK constraint
    // (migration 033) doesn't know about the commercial persona, which
    // is a prompt/behaviour variant, not a different billing bucket.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Commercial mode additionally guarantees a reply when the model
    // came back with nothing usable (empty text, no handoff signal) —
    // the same 24h-window reasoning as the try/catch above, just for the
    // "succeeded but said nothing" failure mode instead of a thrown
    // error. A genuine handoff (explicit sentinel) is NOT covered here:
    // that's a deliberate "a human should take this" decision, not a
    // failure, and the welcome message already opened the window.
    if (isCommercial && !handoff && !text) {
      console.warn(
        '[ai auto-reply] commercial mode: o modelo não devolveu texto — a enviar fallback.',
      )
      await sendCommercialFallback({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
      })
      return
    }

    if (handoff || !text) {
      // Regra do Ricardo (migração 050) — modo comercial APENAS: nunca
      // passar a conversa para a equipa sem nome, email e motivo
      // registados (save_lead_details). Esta trava vive em código, não
      // só no prompt, porque um prompt cede a quem insista. O modo
      // interno (números da equipa) nunca passa por aqui — mantém-se
      // exactamente como antes desta migração.
      let handoffIncomplete = false
      if (isCommercial) {
        const readiness = checkHandoffReadiness({
          contactName: contactRow?.name,
          contactEmail: contactRow?.email,
          escalationReason: conv.escalation_reason as string | null | undefined,
          contactCompany: contactRow?.company,
        })
        if (!readiness.ready) {
          const attemptsSoFar = (conv.handoff_blocked_attempts as number | null) ?? 0
          const maxAttempts =
            config.maxHandoffBlockedAttempts ?? DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS
          if (!shouldForceHandoffThrough(attemptsSoFar, maxAttempts)) {
            // Bloqueado: NÃO desliga o auto-reply, NÃO marca a conversa
            // como passada. Regista a tentativa (sem dados pessoais —
            // só os nomes dos campos em falta) e pede o que falta.
            console.warn(
              `[ai auto-reply] commercial mode: handoff bloqueado (tentativa ${
                attemptsSoFar + 1
              }/${maxAttempts}) — em falta: ${readiness.missing.join(', ')}.`,
            )
            await db
              .from('conversations')
              .update({ handoff_blocked_attempts: attemptsSoFar + 1 })
              .eq('id', conversationId)
            await engineSendText({
              accountId,
              userId: configOwnerUserId,
              conversationId,
              contactId,
              text: buildMissingInfoNudge(readiness.missing),
              aiGenerated: false,
            })
            return
          }
          // Válvula de escape: já bloqueámos vezes suficientes seguidas
          // — deixa passar mesmo incompleto, para não prender alguém
          // irritado num ciclo a pedir dados que não quer dar.
          console.warn(
            '[ai auto-reply] commercial mode: handoff a passar INCOMPLETO após tentativas bloqueadas repetidas — em falta:',
            readiness.missing.join(', '),
          )
          handoffIncomplete = true
        }
      }

      // Regra do Ricardo (21/09/2026, correcção 3) — modo comercial
      // APENAS: chamar a equipa já não desliga o auto-reply. O agente
      // continua a responder normalmente (o prompt sabe-o via
      // `teamAlreadyRequested`) e só se cala quando um humano da
      // equipa escrever nesta conversa (ver send-message.ts, que
      // desliga `ai_autoreply_disabled` num envio `sender_type =
      // 'agent'`). O modo interno (números da equipa) mantém-se
      // exactamente como antes: desliga logo o auto-reply.
      if (isCommercial) {
        if (conv.team_requested_at) {
          // Já chamámos a equipa nesta conversa — não repetir o aviso
          // nem o registo. Não há texto substantivo para enviar este
          // turno (o modelo voltou a sinalizar handoff em vez de
          // responder); nada mais a fazer.
          return
        }
        await sendHandoffNotice({
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
          handoffMessage: config.handoffMessage,
        })
        const summary = buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
          company: contactRow?.company,
        })
        const update: Record<string, unknown> = {
          team_requested_at: new Date().toISOString(),
          ai_handoff_summary: summary,
        }
        if (handoffIncomplete) {
          update.handoff_incomplete = true
        }
        await db.from('conversations').update(update).eq('id', conversationId)

        // Aviso à equipa (Mattermost + WhatsApp) — best-effort, nunca
        // bloqueia nem desfaz o handoff já persistido acima. Ver
        // notify-team.ts.
        void notifyHandoff({
          accountId,
          conversationId,
          contactName: contactRow?.name ?? null,
          company: contactRow?.company ?? null,
          phone: contactRow?.phone ?? null,
          email: contactRow?.email ?? null,
          reason: (conv.escalation_reason as string | null) ?? null,
          lastMessages: messages.slice(-3),
          conversationUrl: `${ETERWA_INBOX_URL}?c=${encodeURIComponent(conversationId)}`,
        }).catch((err) => {
          console.error('[ai auto-reply] notifyHandoff falhou:', err)
        })

        return
      }

      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. A handoff must never be
      // silent: the customer gets a short heads-up FIRST before the bot
      // goes quiet (see sendHandoffNotice's doc comment — this used to
      // leave people talking to no one). Then we (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned`
      // trigger, which notifies the agent.
      await sendHandoffNotice({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        handoffMessage: config.handoffMessage,
      })
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
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
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
