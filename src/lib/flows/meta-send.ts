import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import { toEngineError } from '@/lib/whatsapp/engine-error';
import {
  sendViaConnection,
  type OutboundMessage,
} from '@/lib/whatsapp/send-core';
import { supabaseAdmin } from './admin-client';

// ------------------------------------------------------------
// Senders do lado dos Flows.
//
// Antes da extração do seam, cada função aqui repetia a mesma sequência
// de ~60 linhas (lookup de contato, lookup de config, decrypt, retry de
// variante de telefone, insert em `messages`, update da conversa). Agora
// todas são a mesma chamada a `sendViaConnection` com uma
// `OutboundMessage` diferente.
// ------------------------------------------------------------

interface EngineSendBase {
  /** Chave de tenancy. Um flow escrito pelo usuário A ainda envia pelo
   *  número que o usuário B salvou na mesma conta. */
  accountId: string;
  /** Autor do flow. Nunca consultado para tenancy; mantido porque os
   *  chamadores o passam. */
  userId: string;
  conversationId: string;
  contactId: string;
}

/**
 * Ponte única para o núcleo. `previewText` é passado quando a regra de
 * resumo deste engine diverge do padrão do núcleo — ver cada chamador.
 */
async function engineSend(
  args: EngineSendBase & { aiGenerated?: boolean; previewText?: string },
  message: OutboundMessage
): Promise<{ whatsapp_message_id: string }> {
  try {
    const result = await sendViaConnection(supabaseAdmin(), args.accountId, {
      conversationId: args.conversationId,
      contactId: args.contactId,
      message,
      senderType: 'bot',
      aiGenerated: args.aiGenerated,
      previewText: args.previewText,
    });
    return { whatsapp_message_id: result.providerMessageId };
  } catch (err) {
    throw toEngineError(err);
  }
}

interface SendTextEngineArgs extends EngineSendBase {
  text: string;
  /** Marca a linha `ai_generated = true` para a inbox distinguir a
   *  resposta da IA. Só o auto-reply liga isso. */
  aiGenerated?: boolean;
}

/**
 * Envia texto simples a partir do engine de Flows. Usado pelos nós
 * `send_message` e `collect_input`.
 */
export async function engineSendText(
  args: SendTextEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  // Sem `previewText`: o padrão do núcleo para texto já é o próprio
  // texto, que é o que este engine sempre gravou.
  return engineSend(args, { kind: 'text', text: args.text });
}

interface SendMediaEngineArgs extends EngineSendBase {
  kind: MediaKind;
  /** URL pública que a Meta busca no envio. */
  link: string;
  caption?: string;
  /** Só para documento; a Meta ignora em image/video. */
  filename?: string;
}

/**
 * Envia imagem / vídeo / documento / áudio a partir do engine de Flows.
 * Usado pelo nó `send_media`.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  return engineSend(
    {
      ...args,
      // O núcleo usaria a legenda crua; este engine sempre aparou os
      // espaços antes de cair no rótulo `[image]`.
      previewText: args.caption?.trim() || `[${args.kind}]`,
    },
    {
      kind: 'media',
      mediaKind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
      // Sem `persistedMediaUrl`: este caminho nunca gravou `media_url`.
      // Preservado à risca na Onda 0 — ver Follow-ups.
    }
  );
}

interface SendInteractiveButtonsEngineArgs extends EngineSendBase {
  bodyText: string;
  buttons: InteractiveButton[];
  headerText?: string;
  footerText?: string;
}

interface SendInteractiveListEngineArgs extends EngineSendBase {
  bodyText: string;
  buttonLabel: string;
  sections: InteractiveListSection[];
  headerText?: string;
  footerText?: string;
}

/**
 * Envia mensagem com até 3 botões de resposta. O payload estruturado é
 * persistido para que a thread da inbox re-renderize os botões; o
 * `interactive_reply_id` NÃO é escrito aqui — aquela coluna é do toque
 * do cliente, preenchida pelo webhook.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const payload: InteractiveMessagePayload = {
    kind: 'buttons',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    buttons: args.buttons,
  };
  // O núcleo resumiria a conversa com `interactivePayloadPreviewText`;
  // este engine sempre gravou o corpo cru.
  return engineSend(
    { ...args, previewText: args.bodyText },
    { kind: 'interactive', payload }
  );
}

/**
 * Envia lista interativa. Usado quando o flow tem mais opções do que o
 * limite de 3 botões da Meta.
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const payload: InteractiveMessagePayload = {
    kind: 'list',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    button_label: args.buttonLabel,
    sections: args.sections,
  };
  return engineSend(
    { ...args, previewText: args.bodyText },
    { kind: 'interactive', payload }
  );
}
