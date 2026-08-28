// ============================================================
// Transporte Meta Cloud API.
//
// Concentra tudo que é específico da Meta: o `phone_number_id`, o
// vocabulário `contextMessageId`, e o retry de variantes de telefone
// (`phoneVariants` / `isRecipientNotAllowedError`) — gambiarra do
// sandbox da Meta e do trunk 0 brasileiro que existia copiada em quatro
// arquivos e agora existe uma vez, aqui.
// ============================================================

import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendReactionMessage,
} from '@/lib/whatsapp/meta-api';
import {
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type {
  TransportConnection,
  TransportInteractiveArgs,
  TransportMediaArgs,
  TransportReactionArgs,
  TransportTemplateArgs,
  TransportTextArgs,
  TransportResult,
  WhatsAppTransport,
} from './types';

/**
 * Roda `attempt` contra cada variante plausível do número, avançando SÓ
 * quando a Meta responde "recipient not in allowed list". Qualquer outro
 * erro sobe imediatamente — tentar outra variante contra um template
 * malformado só multiplica a mesma falha.
 */
async function withPhoneVariants(
  to: string,
  attempt: (phone: string) => Promise<string>
): Promise<TransportResult> {
  const variants = phoneVariants(to);
  let lastError: unknown = null;

  for (const variant of variants) {
    try {
      const providerMessageId = await attempt(variant);
      return {
        providerMessageId,
        normalizedRecipient: variant === to ? undefined : variant,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(message)) throw err;
      lastError = err;
      console.warn(
        `[meta-transport] variant "${variant}" rejected by Meta, trying next…`
      );
    }
  }

  // `phoneVariants` só devolve [] para entrada vazia, que o núcleo já
  // barrou em `isValidE164`. O throw existe para que um caminho novo não
  // passe silenciosamente com um id de mensagem vazio.
  throw lastError ?? new Error(`No phone variants to try for "${to}"`);
}

export function createMetaTransport(
  conn: TransportConnection
): WhatsAppTransport {
  const phoneNumberId = conn.phoneNumberId;
  if (!phoneNumberId) {
    throw new Error('Meta transport requires a phone_number_id');
  }
  const accessToken = conn.credential;

  return {
    provider: 'meta',
    capabilities: {
      templates: true,
      interactive: true,
      reactions: true,
      media: true,
    },

    sendText(args: TransportTextArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const r = await sendTextMessage({
          phoneNumberId,
          accessToken,
          to,
          text: args.text,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    sendMedia(args: TransportMediaArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const r = await sendMediaMessage({
          phoneNumberId,
          accessToken,
          to,
          kind: args.mediaKind,
          link: args.link,
          caption: args.caption,
          filename: args.filename,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    sendInteractive(args: TransportInteractiveArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const p = args.payload;
        if (p.kind === 'buttons') {
          const r = await sendInteractiveButtons({
            phoneNumberId,
            accessToken,
            to,
            bodyText: p.body,
            headerText: p.header || undefined,
            footerText: p.footer || undefined,
            buttons: p.buttons,
            contextMessageId: args.replyToProviderMessageId,
          });
          return r.messageId;
        }
        const r = await sendInteractiveList({
          phoneNumberId,
          accessToken,
          to,
          bodyText: p.body,
          buttonLabel: p.button_label,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          sections: p.sections,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    sendTemplate(args: TransportTemplateArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const r = await sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to,
          templateName: args.templateName,
          language: args.language,
          template: args.template,
          messageParams: args.messageParams,
          params: args.params,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    // Sem retry de variantes, de propósito: `/api/whatsapp/react` sempre
    // mandou o número sanitizado direto. Uma reação só é possível numa
    // conversa já estabelecida, onde o número que funciona já foi
    // descoberto e gravado no contato.
    async sendReaction(args: TransportReactionArgs) {
      const r = await sendReactionMessage({
        phoneNumberId,
        accessToken,
        to: args.to,
        targetMessageId: args.targetProviderMessageId,
        emoji: args.emoji,
      });
      return { providerMessageId: r.messageId };
    },
  };
}
