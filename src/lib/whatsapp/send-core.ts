// ============================================================
// Núcleo de envio.
//
// A sequência "resolve contato → confere telefone → resolve conexão →
// confere capacidade → envia pelo transporte → persiste em `messages` →
// atualiza a conversa → pausa o flow ativo" existia copiada em
// `send-message.ts`, `flows/meta-send.ts` e `automations/meta-send.ts`.
// Existe aqui.
//
// O núcleo NÃO cobre:
//   - reações (vão para `message_reactions`, não `messages`);
//   - broadcast (persiste em `broadcast_recipients` e tem duas fases).
// Esses dois usam `resolveConnection` + o transporte diretamente.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { createTransport } from '@/lib/whatsapp/providers';
import {
  UnsupportedCapabilityError,
  type ProviderCapabilities,
  type TransportResult,
  type WhatsAppTransport,
} from '@/lib/whatsapp/providers/types';
import { resolveConnection } from '@/lib/whatsapp/resolve-connection';
import { SendMessageError } from '@/lib/whatsapp/send-error';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

export type OutboundMessage =
  | { kind: 'text'; text: string }
  | {
      kind: 'media';
      mediaKind: MediaKind;
      /** URL pública que o provedor busca no envio. */
      link: string;
      caption?: string | null;
      filename?: string | null;
      /**
       * O que vai para `messages.media_url` — o que a inbox renderiza.
       * Distinto de `link` de propósito: os envios de mídia dos Flows
       * nunca gravaram uma URL, e a Onda 0 preserva isso. Ver Follow-ups.
       */
      persistedMediaUrl?: string | null;
    }
  | { kind: 'interactive'; payload: InteractiveMessagePayload }
  | {
      kind: 'template';
      templateName: string;
      /** Idioma que vai no fio. O chamador já resolveu o en/en_US. */
      language?: string;
      /**
       * Linha local, SÓ quando o chamador quer os componentes completos
       * (header de mídia, botões com variável) no payload — `meta-api`
       * monta o array de components quando recebe isto. A inbox passa; as
       * Automations NÃO passam, porque hoje mandam só `params` no fio.
       */
      template?: MessageTemplate | null;
      messageParams?: SendTimeParams;
      params?: string[];
      /**
       * Corpo a gravar em `messages.content_text`. Calculado pelo
       * chamador porque a inbox e as Automations chegam nele por
       * caminhos diferentes — e porque ele é independente do que vai no
       * fio (as Automations usam a linha local para o texto persistido
       * mesmo sem mandá-la no payload).
       */
      persistedText?: string | null;
    };

export interface SendViaConnectionParams {
  conversationId: string;
  /**
   * Quando presente, o contato é resolvido por id (caminho dos engines,
   * que já têm o contato em mãos). Sem ele, o contato sai da conversa
   * (caminho da inbox / API pública).
   */
  contactId?: string;
  /** Repassado a `resolveConnection`. Onda 0: sem efeito. */
  connectionId?: string;
  message: OutboundMessage;
  senderType: 'agent' | 'bot';
  aiGenerated?: boolean;
  replyToMessageId?: string | null;
  /**
   * Sobrescreve `conversations.last_message_text`. Existe porque os três
   * chamadores calculavam esse resumo com regras ligeiramente diferentes
   * antes deste refactor. Só Flows (mídia, interativo) e Automations
   * (template) passam.
   */
  previewText?: string;
  /**
   * Marca o flow run ativo do contato como `paused_by_agent`. Ligado só
   * pela inbox / API pública: um agente digitando é o sinal mais forte de
   * "cede o lugar, tem humano aqui". Um envio de bot nunca se pausa.
   */
  pauseActiveFlowRun?: boolean;
  /** Repassado a `resolveConnection`. Ligado só pela inbox / API. */
  selfHealCredential?: boolean;
}

export interface SendViaConnectionResult {
  /** Nosso `messages.id`. */
  messageId: string;
  /** Id de mensagem do provedor (Meta: o `wamid`). */
  providerMessageId: string;
}

/** Texto é universal; os demais tipos precisam de uma capacidade. */
function requiredCapability(
  kind: OutboundMessage['kind']
): keyof ProviderCapabilities | null {
  switch (kind) {
    case 'media':
      return 'media';
    case 'interactive':
      return 'interactive';
    case 'template':
      return 'templates';
    default:
      return null;
  }
}

function dispatchSend(
  transport: WhatsAppTransport,
  to: string,
  message: OutboundMessage,
  replyToProviderMessageId: string | undefined
): Promise<TransportResult> {
  switch (message.kind) {
    case 'text':
      return transport.sendText({
        to,
        text: message.text,
        replyToProviderMessageId,
      });
    case 'media':
      return transport.sendMedia({
        to,
        mediaKind: message.mediaKind,
        link: message.link,
        caption: message.caption || undefined,
        filename: message.filename || undefined,
        replyToProviderMessageId,
      });
    case 'interactive':
      return transport.sendInteractive({
        to,
        payload: message.payload,
        replyToProviderMessageId,
      });
    case 'template':
      return transport.sendTemplate({
        to,
        templateName: message.templateName,
        language: message.language,
        template: message.template ?? undefined,
        messageParams: message.messageParams,
        params: message.params,
        replyToProviderMessageId,
      });
  }
}

interface ResolvedContact {
  id: string;
  phone: string;
}

async function loadContact(
  db: SupabaseClient,
  accountId: string,
  params: SendViaConnectionParams
): Promise<ResolvedContact> {
  // Caminho dos engines: o contato já é conhecido por id. O filtro por
  // account_id é defesa em profundidade — os engines usam o cliente
  // service-role, que ignora RLS.
  if (params.contactId) {
    const { data: contact, error } = await db
      .from('contacts')
      .select('id, phone')
      .eq('id', params.contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !contact?.phone) {
      throw new SendMessageError('not_found', 'Contact not found', 404, {
        reason: 'contact_not_found',
      });
    }
    return { id: contact.id, phone: contact.phone };
  }

  // Caminho da inbox / API pública: contato vem da conversa.
  const { data: conversation, error } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', params.conversationId)
    .eq('account_id', accountId)
    .single();

  if (error || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404, {
      reason: 'conversation_not_found',
    });
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400,
      { reason: 'contact_not_found' }
    );
  }
  return { id: contact.id, phone: contact.phone };
}

/**
 * Resolve `replyToMessageId` (nosso UUID) para o id de mensagem do
 * provedor. O pai tem de pertencer à MESMA conversa — senão um chamador
 * poderia citar mensagens que não pode ver, chutando UUIDs.
 */
async function resolveReplyTarget(
  db: SupabaseClient,
  conversationId: string,
  replyToMessageId: string
): Promise<string | undefined> {
  const { data: parent, error } = await db
    .from('messages')
    .select('message_id, conversation_id')
    .eq('id', replyToMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error || !parent) {
    throw new SendMessageError(
      'bad_request',
      'reply_to_message_id not found in this conversation',
      400
    );
  }
  if (!parent.message_id) {
    console.warn(
      '[send-core] reply target has no provider message id; sending without context'
    );
    return undefined;
  }
  return parent.message_id;
}

export async function sendViaConnection(
  db: SupabaseClient,
  accountId: string,
  params: SendViaConnectionParams
): Promise<SendViaConnectionResult> {
  const { message, conversationId } = params;

  // 1. Contato + telefone. Vem antes da conexão porque `send-message.ts`
  //    (o caminho de hoje) resolve a conversa/contato antes de checar a
  //    configuração — um envio para conversa inexistente/alheia tem de
  //    dar 404 mesmo numa conta sem `whatsapp_config`, não 400.
  const contact = await loadContact(db, accountId, params);
  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400,
      { reason: 'contact_phone_invalid', cause: contact.phone }
    );
  }

  // 2. Conexão + transporte.
  let transport: WhatsAppTransport;
  try {
    const connection = await resolveConnection(db, accountId, {
      connectionId: params.connectionId,
      conversationId,
      selfHeal: params.selfHealCredential,
    });
    transport = createTransport(connection);
  } catch (err) {
    // `resolveConnection` já lança `SendMessageError` — deixa passar como
    // está. `createTransport` pode lançar um `Error` cru (ex.: Meta sem
    // `phone_number_id`); o contrato do núcleo é sempre lançar
    // `SendMessageError`, então embrulha o resto com o mesmo código que
    // "não configurado" usa hoje.
    if (err instanceof SendMessageError) throw err;
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured', cause: err }
    );
  }

  // 3. Capacidade — antes de qualquer trabalho de banco, para que um
  //    tipo não suportado dê 400 claro em vez de erro opaco no fio.
  const capability = requiredCapability(message.kind);
  if (capability && !transport.capabilities[capability]) {
    const err = new UnsupportedCapabilityError(transport.provider, capability);
    throw new SendMessageError('bad_request', err.message, 400, {
      reason: 'unsupported_capability',
      cause: err,
    });
  }

  // 4. Alvo da resposta citada.
  const replyToProviderMessageId = params.replyToMessageId
    ? await resolveReplyTarget(db, conversationId, params.replyToMessageId)
    : undefined;

  // 5. Envio.
  let sent: TransportResult;
  try {
    sent = await dispatchSend(
      transport,
      sanitizedPhone,
      message,
      replyToProviderMessageId
    );
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-core] provider send failed:', detail);
    // O prefixo "Meta API error:" é contrato do envelope v1 de hoje. A
    // Onda 1 o torna dependente do provedor.
    throw new SendMessageError('meta_error', `Meta API error: ${detail}`, 502, {
      reason: 'provider_error',
      cause: err,
    });
  }

  // 6. Writeback do telefone que o provedor aceitou.
  if (sent.normalizedRecipient && sent.normalizedRecipient !== sanitizedPhone) {
    console.log(
      `[send-core] auto-corrected contact phone: ${sanitizedPhone} → ${sent.normalizedRecipient}`
    );
    await db
      .from('contacts')
      .update({ phone: sent.normalizedRecipient })
      .eq('id', contact.id);
  }

  // 7. Persistência.
  const contentType =
    message.kind === 'media' ? message.mediaKind : message.kind;
  const persistedText =
    message.kind === 'text'
      ? message.text
      : message.kind === 'media'
        ? (message.caption ?? null)
        : message.kind === 'interactive'
          ? message.payload.body
          : (message.persistedText ?? null);

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: params.senderType,
      content_type: contentType,
      content_text: persistedText,
      media_url:
        message.kind === 'media' ? (message.persistedMediaUrl ?? null) : null,
      template_name: message.kind === 'template' ? message.templateName : null,
      interactive_payload:
        message.kind === 'interactive' ? message.payload : null,
      message_id: sent.providerMessageId,
      status: 'sent',
      ai_generated: params.aiGenerated ?? false,
      reply_to_message_id: params.replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError || !messageRecord) {
    console.error('[send-core] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError?.message ?? 'no row returned'}`,
      500,
      { reason: 'message_insert_failed', cause: msgError?.message }
    );
  }

  // 8. Resumo da conversa.
  const preview =
    params.previewText ??
    (message.kind === 'interactive'
      ? interactivePayloadPreviewText(message.payload)
      : persistedText || `[${contentType}]`);

  const now = new Date().toISOString();
  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId);

  // 9. Pausa do flow ativo. Best-effort: nunca derruba um envio que já
  //    chegou ao provedor.
  if (params.pauseActiveFlowRun) {
    try {
      const { error: pauseErr } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
      if (pauseErr) {
        console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
      }
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    messageId: messageRecord.id,
    providerMessageId: sent.providerMessageId,
  };
}
