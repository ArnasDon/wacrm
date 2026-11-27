import { supabaseAdmin } from './admin-client';
import { loadAiConfig } from './config';
import { buildConversationContext } from './context';
import { retrieveKnowledge } from './knowledge';
import { generateReply } from './generate';
import { buildSystemPrompt } from './defaults';
import { latestUserMessage } from './query';
import { engineSendText, engineSendPayment } from '@/lib/flows/meta-send';
import {
  AI_PAYMENT_CLARIFICATION,
  parseAiTotal,
  resolveAiPayment,
} from './auto-payment';
import { checkZeroTokenMatch } from './fast-path';
import { TEMPLATE_LIMIT_REACHED } from '@/lib/orders/delivery-templates';
import {
  handleConversationHandoff,
  hasActiveHuman,
  sendHandoffNotice,
} from '@/lib/whatsapp/handoff';

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string;
  conversationId: string;
  contactId: string;
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string;
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
 *   - a human agent is assigned AND active (< 30 min since last agent message)
 *     UNLESS customer has been inactive > 4h (configurable)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args;

  try {
    const db = supabaseAdmin();

    const config = await loadAiConfig(db, accountId);
    if (!config || !config.autoReplyEnabled) {
      console.log(
        '[ai auto-reply] blocked: config missing or auto-reply disabled',
        {
          accountId,
          conversationId,
          hasConfig: !!config,
          autoReplyEnabled: config?.autoReplyEnabled ?? false,
        }
      );
      return;
    }

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
      .limit(1);
    if (autoResponders && autoResponders.length > 0) {
      console.log('[ai auto-reply] blocked: active message automation', {
        accountId,
        conversationId,
        autoResponderCount: autoResponders.length,
      });
      return;
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'status, assigned_agent_id, ai_autoreply_disabled, ai_reply_count, last_agent_message_at, bot_order_resumed_at, bot_pause_reason, bot_resume_after'
      )
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr || !conv) {
      console.log('[ai auto-reply] blocked: conversation missing', {
        accountId,
        conversationId,
        convErr: convErr?.message,
      });
      return;
    }

    // Closed conversations are intentionally left for a human to reopen
    // when a fresh inbound arrives from the customer.
    if (conv.status === 'closed') {
      console.log('[ai auto-reply] blocked: conversation closed', {
        accountId,
        conversationId,
        status: conv.status,
      });
      return;
    }

    if (
      hasActiveHuman(
        conv.last_agent_message_at,
        Date.now(),
        conv.bot_order_resumed_at
      )
    ) {
      return;
    }

    // Auto-resume recoverable pauses after 30 minutes (human_active, technical_error,
    // order_review, or non-open-checkout payment_review), while keeping manual,
    // unconfirmed customer_request, and open-checkout payment_review blocked.
    if (conv.ai_autoreply_disabled || conv.status === 'pending') {
      const resumeAtMs = Date.parse(conv.bot_resume_after ?? '');
      const canAutoResume =
        Number.isFinite(resumeAtMs) &&
        resumeAtMs <= Date.now() &&
        conv.bot_pause_reason !== 'manual' &&
        conv.bot_pause_reason !== 'customer_request';

      if (!canAutoResume) {
        return;
      }

      const { data: handoffDecision, error: handoffErr } = await db.rpc(
        'handle_conversation_handoff',
        {
          p_account_id: accountId,
          p_conversation_id: conversationId,
          p_contact_id: contactId,
          p_request: false,
          p_reason: conv.bot_pause_reason ?? 'human_active',
          p_resume: false,
          p_new_order: false,
        }
      );

      if (
        handoffErr ||
        !handoffDecision ||
        (handoffDecision as { blocked?: boolean }).blocked !== false
      ) {
        return;
      }
    }

    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      console.log('[ai auto-reply] blocked: cap reached', {
        accountId,
        conversationId,
        ai_reply_count: conv.ai_reply_count,
        max: config.autoReplyMaxPerConversation,
      });

      // COST-CAP: Envia apenas o link do cardápio sem consumir tokens da LLM
      // Estratégia de custo: última mensagem com CTA clara antes de passar para agente humano
      try {
        // Verifica se já enviou a mensagem de limite (evita reenvio repetido)
        const { data: limitSent } = await db
          .from('conversations')
          .select('id')
          .eq('id', conversationId)
          .eq('ai_autoreply_disabled', true)
          .maybeSingle();

        if (!limitSent) {
          // Primeira vez que o limite é atingido — envia template de fallback
          await engineSendText({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: TEMPLATE_LIMIT_REACHED,
          });

          // Desativa auto-reply para forçar handoff humano
          await db
            .from('conversations')
            .update({ ai_autoreply_disabled: true })
            .eq('id', conversationId);

          console.log(
            '[ai auto-reply] cost-cap: sent fallback template and disabled auto-reply',
            {
              accountId,
              conversationId,
            }
          );
        }
      } catch (err) {
        console.warn(
          '[ai auto-reply] cost-cap: failed to send fallback template:',
          err
        );
      }

      return;
    }

    const messages = await buildConversationContext(db, conversationId);
    if (messages.length === 0) {
      console.log('[ai auto-reply] blocked: empty conversation context', {
        accountId,
        conversationId,
      });
      return;
    }

    const latestText = latestUserMessage(messages);

    // FEATURE: Camada zero-token (Fast Path)
    // Antes de chamar a LLM, tenta combinar perguntas frequentes (cardápio, horário, pix)
    // Economiza tokens e reduz latência em ~90% para respostas determinísticas.
    const fastPathResult = checkZeroTokenMatch(latestText);
    if (fastPathResult.matched && fastPathResult.response) {
      console.log('[ai auto-reply] zero-token match', {
        accountId,
        conversationId,
        pattern: latestText.substring(0, 50),
      });

      // Resposta determinística — não gasta tokens da LLM
      const text = fastPathResult.response;
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
      });
      // Incrementa o contador de respostas da IA mesmo para fast-path
      // (resposta automática é resposta automática)
      const { data: claimed, error: claimErr } = await db.rpc(
        'claim_ai_reply_slot',
        {
          conversation_id: conversationId,
          max_replies: config.autoReplyMaxPerConversation,
        }
      );
      if (claimErr || claimed !== true) {
        console.log(
          '[ai auto-reply] failed to claim reply slot for zero-token match',
          { claimErr }
        );
      }
      return;
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestText
    );

    const systemPrompt =
      buildSystemPrompt({
        userPrompt: config.systemPrompt,
        mode: 'auto_reply',
        knowledge,
      }) +
      '\n\nPayment control: when an existing confirmed order total is explicitly available, you may append exactly one [TOTAL:xxx.xx] using positive BRL with two decimal digits and no spaces. This is only a validation request, never authorization or proof of payment. Never invent totals, checkout URLs, items, address or customer consent. For missing items, address or confirmation, ask one clarifying question instead of handing off solely for missing order information. Never mark payment as approved from customer prose. The server alone validates and sends the real payment button.';

    const { text, handoff } = await generateReply({
      config,
      systemPrompt,
      messages,
    });

    const totalControl = parseAiTotal(text);
    if (totalControl.kind === 'none' && (handoff || !totalControl.text)) {
      await handleConversationHandoff({
        db,
        accountId,
        conversationId,
        contactId,
        text: latestText,
        messageId: `ai:${conversationId}`,
        reason: 'order_review',
        send: (key, notice) =>
          sendHandoffNotice(
            db,
            accountId,
            conversationId,
            key,
            notice,
            (body) =>
              engineSendText({
                accountId,
                userId: configOwnerUserId,
                conversationId,
                contactId,
                text: body,
              })
          ),
      });
      return;
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
      }
    );
    if (claimErr || claimed !== true) return;

    if (totalControl.kind !== 'none') {
      const resolution =
        totalControl.kind === 'valid' && !handoff
          ? await resolveAiPayment(
              db,
              { accountId, conversationId, contactId },
              totalControl.cents
            )
          : { kind: 'clarify' as const, text: AI_PAYMENT_CLARIFICATION };
      if (resolution.kind === 'payment') {
        // Stable canonical reference + deterministic body allow exact outbox replay
        // across model retries without generating another checkout or send.
        await engineSendPayment({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          bodyText: `Total: R$ ${(resolution.cents / 100).toFixed(2).replace('.', ',')}\nEste é o mesmo pagamento do seu pedido. Escolha Pix ou cartão no checkout.`,
          buttonUrl: resolution.url,
          buttonText: 'Pagar pedido',
          effectKey: `ai-payment:${conversationId}:${resolution.reference}`,
        });
      } else {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: resolution.text,
        });
      }
      return;
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
    });
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err);
  }
}
