import type { SupabaseClient } from '@supabase/supabase-js';
import { correctFlowCheckout } from '@/lib/flows/checkout-consent';
import { hasOrderIntent, isCompleteDeliveryAddress } from './text-order-parser';
import { loadOrderCatalog } from './order-catalog';
import { groundCatalogOrder } from '@/lib/flows/catalog-order';
import { hasValidatedQuantifiedOrderIntent } from './order-intent';
import {
  advanceOrderDraft,
  orderSummary,
  type OrderDraft,
} from './order-draft';
import { createOrderWithMercadoPago } from './create-order-with-mercado-pago';
import {
  getSavedCustomerAddress,
  saveContactOrderFields,
} from './custom-fields';
import { applyContactTag, TAG_HUMANO } from './create-order';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { sendWhatsAppPaymentMessage } from '@/lib/whatsapp/payment-message';
import { getExistingPaymentLink } from '@/lib/payments/mercado-pago';
import { exactBrlCents } from '@/lib/payments/payment-identity';
import { classifyFaq, faqResponse } from './store-faq';
import {
  handleConversationHandoff,
  hasActiveHuman,
  isHumanRequest,
  type HandoffReason,
} from '@/lib/whatsapp/handoff';
import {
  isExplicitNewOrder,
  newOrderText,
  shouldStartNewDraft,
} from './draft-lifecycle';

export {
  STANDARD_DELIVERY_CUSTOM_FIELDS,
  type StandardDeliveryCustomField,
  type ContactOrderFieldsInput,
  parseAddressComponents,
  getSavedCustomerAddress,
  saveContactOrderFields,
} from './custom-fields';

export interface TextOrderFlowContext {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
  contactRecord: { id: string; name?: string | null; phone: string };
  contactName: string;
  senderPhone: string;
  conversationId: string;
  inboundText: string;
  inboundMessageId: string;
  inboundTimestamp: string;
  phoneNumberId: string;
  accessToken: string;
}
export interface TextOrderFlowResult {
  handled: boolean;
  outcome?:
    | 'order_created'
    | 'address_requested'
    | 'confirmation_requested'
    | 'payment_resent'
    | 'payment_already_created'
    | 'faq_answered'
    | 'bot_resumed'
    | 'needs_human'
    | 'duplicate';
  error?: string;
}

export const TECHNICAL_ERROR_CUSTOMER_NOTICE =
  'Tivemos uma instabilidade técnica no atendimento automático.';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    };
    if (typeof maybe.message === 'string' && maybe.message) {
      return typeof maybe.code === 'string' && maybe.code
        ? `${maybe.code}: ${maybe.message}`
        : maybe.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function formatErrorDetail(error: unknown): string {
  const detail =
    error instanceof Error && error.stack
      ? error.stack
      : extractErrorMessage(error);
  return detail.slice(0, 2000);
}

export async function recordOrderInboundError(
  db: SupabaseClient,
  input: {
    accountId: string;
    conversationId: string;
    inboundMessageId?: string;
    inboundText?: string;
    ownsTurn?: boolean;
    error: unknown;
  }
): Promise<void> {
  if (!input.inboundMessageId) return;
  const errorDetail = formatErrorDetail(input.error);
  try {
    if (input.ownsTurn) {
      await db
        .from('order_inbound_events')
        .update({ status: 'failed', error_detail: errorDetail })
        .eq('account_id', input.accountId)
        .eq('meta_message_id', input.inboundMessageId);
      return;
    }
    const { error: insertError } = await db
      .from('order_inbound_events')
      .insert({
        account_id: input.accountId,
        meta_message_id: input.inboundMessageId,
        conversation_id: input.conversationId,
        raw_text: input.inboundText ?? '',
        status: 'failed',
        error_detail: errorDetail,
      });
    if (insertError?.code === '23505') {
      await db
        .from('order_inbound_events')
        .update({ status: 'failed', error_detail: errorDetail })
        .eq('account_id', input.accountId)
        .eq('meta_message_id', input.inboundMessageId);
    }
  } catch (logError) {
    console.error('[text-order-flow] failed to record error_detail:', logError);
  }
}

// Cheap lookup gate only: this never grants priority without catalog parsing.
const QUANTITY_CANDIDATE =
  /\d|\b(?:um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|d[uú]zia)\b/i;

async function handoff(
  ctx: TextOrderFlowContext,
  reason: HandoffReason = 'order_review',
  summary?: string,
  onMetaAccepted?: () => void
): Promise<void> {
  await handleConversationHandoff({
    db: ctx.supabase,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    contactId: ctx.contactRecord.id,
    text: ctx.inboundText,
    messageId: ctx.inboundMessageId,
    reason,
    send: async (key, text) => {
      if (summary !== undefined)
        await sendAndRecord(
          ctx,
          key,
          summary ? `${summary}\n${text}` : text,
          undefined,
          onMetaAccepted
        );
    },
  });
  await applyContactTag(ctx.supabase, ctx, ctx.contactRecord.id, TAG_HUMANO);
}

/** Shared by text and native-catalog inbounds before automation or checkout. */
export async function processInboundHandoff(
  ctx: TextOrderFlowContext,
  nativeOrder?: {
    items: Parameters<typeof groundCatalogOrder>[0];
    notes?: string;
  }
): Promise<boolean> {
  const { data: conversation, error } = await ctx.supabase
    .from('conversations')
    .select(
      'ai_autoreply_disabled, last_agent_message_at, bot_order_resumed_at, status'
    )
    .eq('id', ctx.conversationId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) throw error;
  if (
    !isHumanRequest(ctx.inboundText) &&
    !conversation?.ai_autoreply_disabled &&
    !hasActiveHuman(
      conversation?.last_agent_message_at,
      undefined,
      conversation?.bot_order_resumed_at
    ) &&
    conversation?.status !== 'pending'
  )
    return false;
  let orderIntent = false;
  if (
    !isHumanRequest(ctx.inboundText) &&
    (nativeOrder || QUANTITY_CANDIDATE.test(ctx.inboundText))
  ) {
    const catalog = await loadOrderCatalog(ctx.supabase, ctx.accountId);
    if (nativeOrder) {
      try {
        // Notes stay on the original inbound/flow for review. Validate the lines
        // only here; resumption is not authorization to discard notes or charge.
        groundCatalogOrder(nativeOrder.items, catalog);
        orderIntent = true;
      } catch {
        // Invalid cart follows the existing persisted handoff policy.
      }
    } else
      orderIntent = hasValidatedQuantifiedOrderIntent(
        newOrderText(ctx.inboundText),
        catalog
      );
  }
  return handleConversationHandoff({
    db: ctx.supabase,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    contactId: ctx.contactRecord.id,
    text: ctx.inboundText,
    messageId: ctx.inboundMessageId,
    send: (key, text) => sendAndRecord(ctx, key, text),
    orderIntent,
  });
}

async function saveDraft(
  ctx: TextOrderFlowContext,
  draft: OrderDraft,
  release = false
): Promise<void> {
  const { data, error } = await ctx.supabase
    .from('order_drafts')
    .update({
      state: draft,
      ...(release ? { processing_message_id: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', ctx.accountId)
    .eq('conversation_id', ctx.conversationId)
    .eq('processing_message_id', ctx.inboundMessageId)
    .select('id')
    .single();
  if (error || !data)
    throw new Error(error?.message || 'Order turn lost its durable claim');
}

/** At-most-once outbound effect. Ambiguous sends remain reserved for reconciliation. */
async function sendAndRecord(
  ctx: TextOrderFlowContext,
  effectKey: string,
  text: string,
  paymentUrl?: string,
  onOutboundAttempted?: () => void
): Promise<void> {
  const db = ctx.supabase;
  const { error: claimError } = await db.from('order_message_outbox').insert({
    account_id: ctx.accountId,
    conversation_id: ctx.conversationId,
    effect_key: effectKey,
    status: 'sending',
    payload: { text, paymentUrl },
  });
  if (claimError?.code === '23505') return;
  if (claimError) throw claimError;
  onOutboundAttempted?.();
  try {
    let record: {
      messageId: string;
      contentType: string;
      formattedText: string;
      interactivePayload?: unknown;
    };
    if (paymentUrl)
      record = await sendWhatsAppPaymentMessage({
        phoneNumberId: ctx.phoneNumberId,
        accessToken: ctx.accessToken,
        toPhone: ctx.senderPhone,
        bodyText: text,
        buttonUrl: paymentUrl,
        buttonText: '💳 Pagar Agora',
        lastCustomerMessageAt: ctx.inboundTimestamp,
      });
    else {
      const age = Date.now() - Date.parse(ctx.inboundTimestamp);
      if (!Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60 * 1000)
        throw new Error(
          'Janela de atendimento encerrada; é necessário um template aprovado.'
        );
      const result = await sendTextMessage({
        phoneNumberId: ctx.phoneNumberId,
        accessToken: ctx.accessToken,
        to: ctx.senderPhone,
        text,
      });
      if (!result.messageId)
        throw new Error(
          'Envio sem confirmação da Meta; não repetir automaticamente.'
        );
      record = {
        messageId: result.messageId,
        contentType: 'text',
        formattedText: text,
      };
    }
    // Save the receipt first: DB failure afterwards must never repeat an accepted Meta send.
    const { error: receiptError } = await db
      .from('order_message_outbox')
      .update({ status: 'sent', message_id: record.messageId, payload: record })
      .eq('account_id', ctx.accountId)
      .eq('effect_key', effectKey);
    if (receiptError) throw receiptError;
    const { error: messageError } = await db.from('messages').insert({
      conversation_id: ctx.conversationId,
      sender_type: 'bot',
      content_type: record.contentType,
      content_text: record.formattedText,
      interactive_payload: record.interactivePayload ?? null,
      message_id: record.messageId,
      status: 'sent',
    });
    if (messageError) throw messageError;
  } catch (error) {
    await db
      .from('order_message_outbox')
      .update({ status: 'uncertain' })
      .eq('account_id', ctx.accountId)
      .eq('effect_key', effectKey);
    throw error;
  }
}

async function completeTurn(
  ctx: TextOrderFlowContext,
  draft: OrderDraft
): Promise<void> {
  const { error } = await ctx.supabase
    .from('order_inbound_events')
    .update({ status: 'completed' })
    .eq('account_id', ctx.accountId)
    .eq('meta_message_id', ctx.inboundMessageId);
  if (error) throw error;
  await saveDraft(ctx, draft, true);
}

async function resendExistingPayment(
  ctx: TextOrderFlowContext,
  draft: OrderDraft
): Promise<void> {
  const reference =
    draft.paymentReference || `TEXT-${draft.id}-${draft.version}`;
  const { data: order, error } = await ctx.supabase
    .from('orders')
    .select(
      'id, account_id, contact_id, preference_id, external_reference, total, payment_url, status'
    )
    .eq('account_id', ctx.accountId)
    .eq('contact_id', ctx.contactRecord.id)
    .eq('external_reference', reference)
    .maybeSingle();
  if (
    error ||
    !order?.id ||
    order.account_id !== ctx.accountId ||
    order.contact_id !== ctx.contactRecord.id ||
    order.external_reference !== reference ||
    !order.preference_id ||
    !order.payment_url ||
    order.status !== 'pending' ||
    exactBrlCents(order.total) === null ||
    exactBrlCents(order.total) !== exactBrlCents(draft.total)
  )
    throw new Error(
      'Pedido existente não validado; um atendente deve reconciliar o pagamento.'
    );
  const binding = await ctx.supabase
    .from('orders')
    .select('id, account_id')
    .eq('preference_id', order.preference_id)
    .maybeSingle();
  if (
    binding.error ||
    binding.data?.id !== order.id ||
    binding.data?.account_id !== ctx.accountId
  )
    throw new Error('Vínculo do pagamento existente inválido ou ambíguo.');
  const url = await getExistingPaymentLink(order);
  await sendAndRecord(
    ctx,
    `payment-resend:${ctx.inboundMessageId}`,
    `La Empanadas — Pedido ${order.id}\nTotal: R$ ${draft.total.toFixed(2).replace('.', ',')}\nEste é o mesmo pagamento do seu pedido.\nPara obter o Pix Copia e Cola, escolha Pix no checkout.`,
    url
  );
}

export async function processFreeTextOrderInbound(
  ctx: TextOrderFlowContext
): Promise<TextOrderFlowResult> {
  const db = ctx.supabase;
  let ownsTurn = false;
  let catalogRunOwnsTurn = false;
  let outboundAcceptedInTurn = false;
  const markOutboundAccepted = () => {
    outboundAcceptedInTurn = true;
  };
  try {
    const priorEvent = await db
      .from('order_inbound_events')
      .select('status')
      .eq('account_id', ctx.accountId)
      .eq('meta_message_id', ctx.inboundMessageId)
      .maybeSingle();
    if (priorEvent.error) throw priorEvent.error;
    if (priorEvent.data) return { handled: true, outcome: 'duplicate' };
    if (await processInboundHandoff(ctx))
      return { handled: true, outcome: 'needs_human' };
    if (/^continuar com o bot[.!?]*$/i.test(ctx.inboundText.trim())) {
      await sendAndRecord(
        ctx,
        `resume:${ctx.inboundMessageId}`,
        'Voltei! Posso ajudar com seu pedido. Nenhuma cobrança foi criada.',
        undefined,
        markOutboundAccepted
      );
      return { handled: true, outcome: 'bot_resumed' };
    }
    const { data: existing, error: readError } = await db
      .from('order_drafts')
      .select('state, updated_at')
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', ctx.conversationId)
      .maybeSingle();
    if (readError) throw readError;
    const existingState = existing?.state as Partial<OrderDraft> | undefined;
    const hasActiveDraft = Boolean(
      existingState &&
        ((Array.isArray(existingState.items) && existingState.items.length > 0) ||
          (Array.isArray(existingState.unresolved) &&
            existingState.unresolved.length > 0) ||
          existingState.stage === 'payment_created' ||
          Boolean(existingState.deliveryAddress))
    );
    if (
      !hasActiveDraft &&
      !hasOrderIntent(ctx.inboundText) &&
      (!QUANTITY_CANDIDATE.test(ctx.inboundText) ||
        !hasValidatedQuantifiedOrderIntent(
          newOrderText(ctx.inboundText),
          await loadOrderCatalog(db, ctx.accountId)
        ))
    )
      return { handled: false };
    if (!ctx.inboundMessageId)
      throw new Error('Missing inbound Meta message ID');
    const { data: activeFlow, error: flowError } = await db
      .from('flow_runs')
      .select(
        'id, account_id, flow_id, user_id, contact_id, conversation_id, status, current_node_key, consent_revision, vars'
      )
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', ctx.conversationId)
      .eq('status', 'active')
      .maybeSingle();
    if (flowError) throw flowError;
    const catalogOwnsTurn = activeFlow && Array.isArray(activeFlow.vars?.itens);
    catalogRunOwnsTurn = Boolean(catalogOwnsTurn);
    // The new catalog run owns delivery/address/confirmation replies even when
    // an old text draft remains persisted (including payment_created).
    if (catalogOwnsTurn && !hasOrderIntent(ctx.inboundText))
      return { handled: false };

    // Do not steal item corrections from an active catalog order into a new text draft.
    // The original cart remains intact; an attendant reviews the persisted inbound change.
    if (catalogOwnsTurn) {
      await correctFlowCheckout(db, activeFlow, ctx.inboundText);
      await sendAndRecord(
        ctx,
        `turn:${ctx.inboundMessageId}`,
        'Sua alteração foi preservada para revisão. Se o checkout já iniciou, um atendente reconciliará o pedido e o pagamento; não presumimos cancelamento.',
        undefined,
        markOutboundAccepted
      );
      return { handled: true, outcome: 'needs_human' };
    }
    const { data: claim, error: claimError } = await db.rpc(
      'claim_order_turn',
      {
        p_account_id: ctx.accountId,
        p_conversation_id: ctx.conversationId,
        p_contact_id: ctx.contactRecord.id,
        p_message_id: ctx.inboundMessageId,
        p_text: ctx.inboundText,
      }
    );
    if (claimError) throw claimError;
    if (claim?.outcome === 'duplicate')
      return { handled: true, outcome: 'duplicate' };
    if (claim?.outcome !== 'claimed') {
      const busyMessage =
        'Outro turno está em processamento; atendimento necessário.';
      console.error('[text-order-flow] busy turn technical_error:', {
        accountId: ctx.accountId,
        conversationId: ctx.conversationId,
        inboundMessageId: ctx.inboundMessageId,
      });
      await db
        .from('order_inbound_events')
        .update({ error_detail: busyMessage })
        .eq('account_id', ctx.accountId)
        .eq('meta_message_id', ctx.inboundMessageId);
      await handoff(
        ctx,
        'technical_error',
        TECHNICAL_ERROR_CUSTOMER_NOTICE,
        markOutboundAccepted
      );
      return {
        handled: true,
        outcome: 'needs_human',
        error: busyMessage,
      };
    }
    ownsTurn = true;
    const initial: OrderDraft = {
      id: claim.id,
      version: 0,
      items: [],
      unresolved: [],
      stage: 'collecting',
      total: 0,
    };
    let previous = claim.state?.id ? (claim.state as OrderDraft) : initial;
    if (
      previous.items.length &&
      hasOrderIntent(newOrderText(ctx.inboundText))
    ) {
      const { data: linkedOrder, error: linkedError } = await db
        .from('orders')
        .select('status')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', ctx.contactRecord.id)
        .eq(
          'external_reference',
          previous.paymentReference || `TEXT-${previous.id}-${previous.version}`
        )
        .maybeSingle();
      if (linkedError) throw linkedError;
      const activity = Date.parse(
        (previous as OrderDraft & { cartUpdatedAt?: string }).cartUpdatedAt ||
          existing?.updated_at ||
          ''
      );
      if (
        shouldStartNewDraft(
          previous,
          ctx.inboundText,
          linkedOrder?.status ?? null,
          activity
        )
      ) {
        const rotated = await db.rpc('rotate_order_draft', {
          p_account_id: ctx.accountId,
          p_conversation_id: ctx.conversationId,
          p_message_id: ctx.inboundMessageId,
          p_snapshot: previous,
          p_explicit_new: isExplicitNewOrder(ctx.inboundText),
        });
        if (rotated.error || !rotated.data?.id)
          throw new Error(rotated.error?.message || 'Draft rotation failed');
        previous = rotated.data as OrderDraft;
      }
    }
    if (previous.stage === 'payment_created') {
      const faq = classifyFaq(ctx.inboundText);
      if (faq) {
        const response = faqResponse(faq, ctx.inboundText);
        await sendAndRecord(
          ctx,
          `faq:${ctx.inboundMessageId}`,
          response.text,
          undefined,
          markOutboundAccepted
        );
        // Unknown store policy is not permission to change the order or lift
        // review. Known FAQs only complete this turn with the frozen draft.
        if (response.needsHandoff) await handoff(ctx, 'payment_review');
        await completeTurn(ctx, previous);
        return {
          handled: true,
          outcome: response.needsHandoff ? 'needs_human' : 'faq_answered',
        };
      }
      const text = ctx.inboundText
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/[.!?]+$/, '')
        .trim();
      const resend =
        /^(?:(?:por favor|pode|poderia)\s+)?(?:reenvie|reenviar|reenvia|manda|mande|envia|envie)\s+(?:o\s+)?(?:link(?:\s+de\s+pagamento)?|pagamento|botao(?:\s+de\s+pagamento)?)(?:\s+(?:de novo|novamente))?(?:\s+por favor)?$/.test(
          text
        );
      const acknowledgement =
        /^(?:ok|okay|sim|certo|beleza|obrigado|obrigada|valeu|entendi)$/.test(
          text
        );
      if (resend) await resendExistingPayment(ctx, previous);
      else if (!acknowledgement) {
        await handoff(
          ctx,
          'payment_review',
          advanceOrderDraft(previous, ctx.inboundText, []).reply
        );
      }
      await completeTurn(ctx, previous);
      return {
        handled: true,
        outcome: resend
          ? 'payment_resent'
          : acknowledgement
            ? 'payment_already_created'
            : 'needs_human',
      };
    }
    const catalog = await loadOrderCatalog(db, ctx.accountId);
    const savedAddress = await getSavedCustomerAddress(
      db,
      ctx.accountId,
      ctx.contactRecord.id
    );
    const transition = advanceOrderDraft(
      previous,
      newOrderText(ctx.inboundText),
      catalog,
      savedAddress
    );
    const draft = transition.draft;
    if (
      JSON.stringify(previous.items) !== JSON.stringify(draft.items) ||
      previous.deliveryAddress !== draft.deliveryAddress
    )
      (draft as OrderDraft & { cartUpdatedAt: string }).cartUpdatedAt =
        new Date().toISOString();
    else if (!(draft as OrderDraft & { cartUpdatedAt?: string }).cartUpdatedAt)
      (draft as OrderDraft & { cartUpdatedAt: string }).cartUpdatedAt =
        existing?.updated_at || new Date().toISOString();
    await saveDraft(ctx, draft);
    const customerName = ctx.contactRecord.name || ctx.contactName || 'Cliente';
    await saveContactOrderFields(db, ctx.accountId, ctx.contactRecord.id, {
      itens: orderSummary(draft),
      endereco: isCompleteDeliveryAddress(draft.deliveryAddress || '')
        ? draft.deliveryAddress
        : undefined,
      nomeCliente: customerName,
    });
    if (transition.checkout) {
      const reference = `TEXT-${draft.id}-${draft.version}`;
      const result = await createOrderWithMercadoPago(
        { accountId: ctx.accountId, userId: ctx.userId },
        {
          contactId: ctx.contactRecord.id,
          customerName,
          deliveryKind: 'delivery',
          deliveryAddress: draft.deliveryAddress,
          items: draft.items.map((item) => ({
            id: item.id,
            title: item.title,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            description: item.notes,
            requestedText: item.requestedText,
          })),
          conversationId: ctx.conversationId,
          payerPhone: ctx.senderPhone,
          externalReference: reference,
        }
      );
      if (!result.ok || !result.link_mercado_pago)
        throw new Error(
          result.error || 'Falha ao criar pagamento; atendimento necessário.'
        );
      draft.stage = 'payment_created';
      if (result.externalReference)
        draft.paymentReference = result.externalReference;
      await saveDraft(ctx, draft);
      await sendAndRecord(
        ctx,
        `payment:${reference}`,
        `La Empanadas — Pedido ${result.orderId || result.dealId || draft.id}\nTotal: R$ ${draft.total.toFixed(2).replace('.', ',')}\nPague com segurança pelo Mercado Pago.\nPara obter o Pix Copia e Cola, escolha Pix no checkout.`,
        result.link_mercado_pago,
        markOutboundAccepted
      );
    } else {
      const reply =
        draft.stage === 'awaiting_address' && savedAddress
          ? `${transition.reply}\nOu responda SIM para usar o endereço cadastrado: ${savedAddress}`
          : transition.reply;
      if (draft.stage === 'needs_human' || draft.stage === 'payment_created')
        await handoff(ctx, 'order_review', reply, markOutboundAccepted);
      else
        await sendAndRecord(
          ctx,
          `turn:${ctx.inboundMessageId}`,
          reply,
          undefined,
          markOutboundAccepted
        );
    }
    await completeTurn(ctx, draft);
    return {
      handled: true,
      outcome: transition.checkout
        ? 'order_created'
        : draft.stage === 'needs_human' || draft.stage === 'payment_created'
          ? 'needs_human'
          : draft.stage === 'awaiting_address'
            ? 'address_requested'
            : 'confirmation_requested',
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error('[text-order-flow] technical_error:', {
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      inboundMessageId: ctx.inboundMessageId,
      error: message,
    });
    // Fail closed: no LLM/legacy payment fallback and no automatic uncertain-effect retry.
    await recordOrderInboundError(db, {
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      inboundMessageId: ctx.inboundMessageId,
      inboundText: ctx.inboundText,
      ownsTurn,
      error,
    });
    try {
      // Catalog ownership is exclusively changed by the consent RPC. A failed
      // RPC/notice must not let this stale text worker hand off a newer run.
      if (!catalogRunOwnsTurn) {
        await handoff(
          ctx,
          'technical_error',
          outboundAcceptedInTurn ? undefined : TECHNICAL_ERROR_CUSTOMER_NOTICE
        );
      }
    } catch (handoffError) {
      console.error(
        '[text-order-flow] handoff persistence failed',
        handoffError
      );
    }
    return {
      handled: true,
      outcome: 'needs_human',
      error: message,
    };
  }
}
