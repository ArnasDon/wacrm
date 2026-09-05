// ============================================================
// Envio de mensagem — a fachada que tanto a rota `/api/whatsapp/send`
// do dashboard quanto a pública `/api/v1/messages` chamam.
//
// Dado uma conversa e os params da mensagem, este arquivo:
//   1. valida o formato dos params para o tipo de mensagem,
//   2. resolve a linha de template local — quando o tipo é
//      `template` —, ABORTANDO com `template_malformed` numa linha
//      malformada, e coloca o idioma resolvido (não o cru pedido pelo
//      chamador) no fio,
//   3. calcula o corpo persistido de templates (o composer pré-
//      renderiza e manda em `contentText`; ver `persistedText` abaixo),
//   4. monta um `OutboundMessage` a partir de tudo isso e delega a
//      `sendViaConnection`, do núcleo (`send-core.ts`).
//
// Tudo o que costumava estar aqui — resolver a conexão, decriptar a
// credencial, chamar o provedor, tentar variantes de telefone,
// persistir a mensagem, atualizar a conversa e pausar o flow ativo —
// agora vive atrás de `sendViaConnection`, espalhado entre
// `send-core.ts`, `resolve-connection.ts` e `providers/meta-transport.ts`.
//
// Este arquivo segue transport-agnostic: recebe um `SupabaseClient` e
// um `accountId` e lança `SendMessageError` na falha. Os dois
// chamadores são donos de auth, rate-limiting, parsing do corpo, e do
// mapeamento do erro para o próprio formato de resposta (`{ error }`
// interno vs. o envelope v1).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import type { MessageTemplate } from '@/types';
import {
  resolveTemplateRow,
  templateBodyParams,
  templateContentText,
} from '@/lib/whatsapp/template-body';
import {
  sendViaConnection,
  type OutboundMessage,
} from '@/lib/whatsapp/send-core';
import { SendMessageError } from '@/lib/whatsapp/send-error';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

// `SendMessageError` mora em `send-error.ts` desde a extração do seam,
// para que `send-core.ts` o importe sem ciclo. Re-exportado aqui
// porque `resolve-conversation.ts`, as duas rotas e os testes ainda
// importam a classe deste caminho — o de sempre —, e continuam
// podendo.
export { SendMessageError } from '@/lib/whatsapp/send-error';
export type { SendFailureReason } from '@/lib/whatsapp/send-error';

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const {
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Resolução de template: fica aqui, não no núcleo, porque esta é a
  // única superfície que ABORTA numa linha local malformada (e devolve
  // `template_malformed` no envelope v1) e que manda `resolved.language`
  // no fio em vez do idioma cru pedido pelo chamador.
  let templateRow: MessageTemplate | null = null;
  let sendLanguage = templateLanguage || 'en_US';
  if (messageType === 'template' && templateName) {
    const resolved = await resolveTemplateRow(
      db,
      accountId,
      templateName,
      templateLanguage
    );
    if (resolved.malformed) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500,
        { reason: 'template_malformed' }
      );
    }
    templateRow = resolved.row;
    sendLanguage = resolved.language;
  }

  const message: OutboundMessage =
    messageType === 'template'
      ? {
          kind: 'template',
          templateName: templateName!,
          language: sendLanguage,
          template: templateRow,
          // `templateMessageParams` é `unknown` no contrato público; o
          // `?? undefined` é a expressão que este arquivo já usava ao
          // chamar `sendTemplateMessage`, preservada à risca. (Verificado:
          // `meta-api` só acessa este objeto com optional chaining
          // — `messageParams?.body` etc. — então null e undefined são
          // equivalentes ali; o `??` fica por fidelidade, não por
          // necessidade.)
          messageParams: (templateMessageParams ?? undefined) as
            SendTimeParams | undefined,
          params: templateParams || [],
          // Corpo *substituído*: o composer pré-renderiza e manda em
          // `contentText`; todo outro chamador manda nada, e gravar null
          // aqui deixava a inbox com bolha vazia (issue #483).
          persistedText: templateContentText(
            templateRow,
            templateBodyParams(templateParams, templateMessageParams),
            contentText
          ),
        }
      : isMediaKind
        ? {
            kind: 'media',
            mediaKind: messageType as MediaKind,
            link: mediaUrl!,
            caption: contentText,
            filename,
            persistedMediaUrl: mediaUrl!,
          }
        : messageType === 'interactive'
          ? { kind: 'interactive', payload: interactivePayload! }
          : { kind: 'text', text: contentText! };

  const result = await sendViaConnection(db, accountId, {
    conversationId,
    message,
    senderType: 'agent',
    replyToMessageId,
    // Único caminho que reescrevia ciphertext CBC legado antes do
    // refactor; segue sendo o único.
    selfHealCredential: true,
    // Um agente digitando é o sinal mais forte de "cede o lugar".
    pauseActiveFlowRun: true,
  });

  return {
    messageId: result.messageId,
    whatsappMessageId: result.providerMessageId,
  };
}
